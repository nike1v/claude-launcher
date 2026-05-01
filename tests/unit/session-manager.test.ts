import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { SessionManager } from '../../src/main/session-manager'
import { initProviders } from '../../src/main/providers/init'
import { unregisterAll } from '../../src/main/providers/registry'
import type { Environment, Project } from '../../src/shared/types'

const makeProcess = () => {
  const emitter = new EventEmitter()
  const stdinWritten: string[] = []
  const stdin = Object.assign(new EventEmitter(), {
    write: vi.fn((data: string) => stdinWritten.push(data)),
    end: vi.fn(),
    // session-manager's writeStdin guard checks these before writing —
    // matches the shape of a real node Writable stream.
    writable: true,
    destroyed: false
  })
  return Object.assign(emitter, {
    pid: 42,
    stdin,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
    _written: stdinWritten
  })
}

const makeEnv = (): Environment => ({
  id: 'env-1',
  name: 'Test WSL',
  config: { kind: 'wsl', distro: 'Ubuntu' }
})

const makeProject = (): Project => ({
  id: 'proj-1',
  name: 'Test',
  environmentId: 'env-1',
  path: '/tmp'
})

describe('SessionManager construction', () => {
  it('constructs with no args (uses default transport resolver) without throwing', () => {
    // Regression for v0.4.1: the parameter property used the same name as
    // the imported default resolver, which put the imported binding in TDZ
    // for the default expression and broke `new SessionManager()` at module
    // init time. The whole main process then crashed silently and the
    // renderer's IPC invokes sat unanswered (blank sidebar in the wild).
    expect(() => new SessionManager()).not.toThrow()
  })
})

describe('SessionManager', () => {
  let mockTransport: {
    spawn: ReturnType<typeof vi.fn>
    probe: ReturnType<typeof vi.fn>
  }
  let manager: SessionManager
  let onEvent: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // SessionManager._runSession resolves a provider from the registry —
    // wire claude in fresh per test so they don't carry state across.
    unregisterAll()
    initProviders()

    const proc = makeProcess()
    mockTransport = {
      spawn: vi.fn(() => proc),
      probe: vi.fn(async () => ({ ok: true as const, version: '1.0.0 (Claude Code)' }))
    }
    onEvent = vi.fn()
    manager = new SessionManager(
      () => mockTransport as any,
      onEvent
    )
  })

  it('starts a session and returns session id', async () => {
    const sessionId = await manager.startSession(makeEnv(), makeProject())
    expect(typeof sessionId).toBe('string')
    expect(sessionId.length).toBeGreaterThan(0)
    expect(mockTransport.spawn).toHaveBeenCalledOnce()
  })

  it('emits session:status starting on start', async () => {
    await manager.startSession(makeEnv(), makeProject())
    expect(onEvent).toHaveBeenCalledWith(
      'session:status',
      expect.objectContaining({ status: 'starting' })
    )
  })

  it('sends message as JSON line to stdin', async () => {
    const sessionId = await manager.startSession(makeEnv(), makeProject())
    manager.sendMessage(sessionId, 'hello')
    const proc = mockTransport.spawn.mock.results[0].value
    expect(proc.stdin.write).toHaveBeenCalledWith(
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }) + '\n'
    )
  })

  it('stops session and kills process', async () => {
    const sessionId = await manager.startSession(makeEnv(), makeProject())
    manager.stopSession(sessionId)
    const proc = mockTransport.spawn.mock.results[0].value
    expect(proc.kill).toHaveBeenCalled()
    expect(onEvent).toHaveBeenCalledWith(
      'session:status',
      expect.objectContaining({ status: 'closed' })
    )
  })

  it('emits normalized events from stdout via the provider adapter', async () => {
    await manager.startSession(makeEnv(), makeProject())
    const proc = mockTransport.spawn.mock.results[0].value

    const line = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg-1', type: 'message', role: 'assistant',
        content: [{ type: 'text', text: 'Hi' }],
        model: 'claude-sonnet-4-5', stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 3 }
      }
    })

    proc.stdout.emit('data', Buffer.from(line + '\n'))

    // ClaudeAdapter translates the assistant event into a batch:
    // turn.started → tokenUsage.updated → item.started(assistant_message)
    //   → content.delta(assistant_text, "Hi") → item.completed.
    // session-manager delivers the whole batch as one IPC message.
    const eventCalls = onEvent.mock.calls.filter(c => c[0] === 'session:event')
    expect(eventCalls).toHaveLength(1)
    const batch = (eventCalls[0][1] as { events: { kind: string }[] }).events
    const kinds = batch.map(e => e.kind)
    expect(kinds).toContain('turn.started')
    expect(kinds).toContain('item.started')
    expect(kinds).toContain('content.delta')
    expect(kinds).toContain('item.completed')
  })

  it('kills the session and emits error when stdout buffers past the cap without a newline', async () => {
    const sessionId = await manager.startSession(makeEnv(), makeProject())
    const proc = mockTransport.spawn.mock.results[0].value

    // Push 5 MiB of unbroken bytes — well past the 4 MiB cap. Without the
    // bound, lineBuffer would just keep growing on a runaway / corrupted
    // stream until the heap was exhausted.
    proc.stdout.emit('data', Buffer.alloc(5 * 1024 * 1024, 0x61))

    expect(onEvent).toHaveBeenCalledWith(
      'session:status',
      expect.objectContaining({ sessionId, status: 'error' })
    )
    expect(proc.kill).toHaveBeenCalled()
  })

  it('truncates stderr accumulation past the cap in the exit-error message', async () => {
    const sessionId = await manager.startSession(makeEnv(), makeProject())
    const proc = mockTransport.spawn.mock.results[0].value

    // 32 KiB of stderr; cap is 16 KiB and we surface only the last 2 KiB.
    proc.stderr.emit('data', Buffer.alloc(32 * 1024, 0x78))
    proc.emit('exit', 1)

    const errorCall = onEvent.mock.calls.find(
      ([channel, payload]) =>
        channel === 'session:status' && payload.sessionId === sessionId && payload.status === 'error'
    )
    expect(errorCall).toBeDefined()
    const message = errorCall![1].errorMessage as string
    // We should see a tail no larger than the surface cap (~2 KiB) plus the
    // exit-code prefix — far below the raw 32 KiB the child emitted.
    expect(message.length).toBeLessThan(3 * 1024)
  })

  it('interrupt writes a control_request/interrupt JSON line and does NOT kill the process', async () => {
    // The Stop button mirrors claude CLI's ESC: send an in-band
    // interrupt and trust the CLI. We deliberately don't kill the
    // child — signalling tears down the WSL/SSH wrapper, which closes
    // the whole chat instead of aborting just the turn (the v0.4.4
    // regression). If the CLI ignores the interrupt and the spinner
    // hangs, the renderer's stale-busy hint tells the user to close
    // the tab manually.
    const sessionId = await manager.startSession(makeEnv(), makeProject())
    manager.interruptSession(sessionId)
    const proc = mockTransport.spawn.mock.results[0].value

    expect(proc.kill).not.toHaveBeenCalled()

    const writes = proc._written as string[]
    const interruptLine = writes.find(line => line.includes('"control_request"'))
    expect(interruptLine).toBeDefined()
    const parsed = JSON.parse(interruptLine!.trim())
    expect(parsed.type).toBe('control_request')
    expect(parsed.request).toEqual({ subtype: 'interrupt' })
    expect(parsed.request_id).toMatch(/^req_/)
  })

  it('interrupt is idempotent — repeated clicks send only one protocol message', async () => {
    // The session enters 'interrupting' on the first click and stays
    // there until turn.completed (or session-end). Subsequent clicks
    // are no-ops — no extra wire bytes, no kill, no state thrash. The
    // UI mirrors this by disabling the Stop button on 'interrupting'.
    const sessionId = await manager.startSession(makeEnv(), makeProject())
    const proc = mockTransport.spawn.mock.results[0].value
    manager.interruptSession(sessionId)
    manager.interruptSession(sessionId)
    manager.interruptSession(sessionId)
    expect(proc.kill).not.toHaveBeenCalled()
    const writes = (proc._written as string[]).filter(l => l.includes('"control_request"'))
    expect(writes).toHaveLength(1)
  })

  it('emits status: interrupting after a Stop click and not ready until turn.completed', async () => {
    const sessionId = await manager.startSession(makeEnv(), makeProject())
    onEvent.mockClear()
    manager.interruptSession(sessionId)
    expect(onEvent).toHaveBeenCalledWith(
      'session:status',
      expect.objectContaining({ sessionId, status: 'interrupting' })
    )
    // No 'ready' until the provider acknowledges via turn.completed.
    expect(onEvent).not.toHaveBeenCalledWith(
      'session:status',
      expect.objectContaining({ sessionId, status: 'ready' })
    )
  })

  it('blocks sendMessage while interrupting (no piling onto the stdin pipe)', async () => {
    const sessionId = await manager.startSession(makeEnv(), makeProject())
    const proc = mockTransport.spawn.mock.results[0].value
    manager.interruptSession(sessionId)
    proc.stdin.write.mockClear()
    manager.sendMessage(sessionId, 'queued message?')
    expect(proc.stdin.write).not.toHaveBeenCalled()
  })

  it('lifts the interrupt block once turn.completed lands', async () => {
    const sessionId = await manager.startSession(makeEnv(), makeProject())
    const proc = mockTransport.spawn.mock.results[0].value

    // Open a turn first so claude-adapter has something to close.
    const assistantLine = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg-1', type: 'message', role: 'assistant',
        content: [{ type: 'text', text: 'partial' }],
        model: 'claude-sonnet-4-5', stop_reason: null,
        usage: { input_tokens: 5, output_tokens: 1 }
      }
    })
    proc.stdout.emit('data', Buffer.from(assistantLine + '\n'))

    manager.interruptSession(sessionId)

    const resultLine = JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: 'sess-1',
      is_error: false,
      num_turns: 1
    })
    proc.stdout.emit('data', Buffer.from(resultLine + '\n'))

    // Status flips back to 'ready' after the provider's turn.completed.
    expect(onEvent).toHaveBeenCalledWith(
      'session:status',
      expect.objectContaining({ sessionId, status: 'ready' })
    )

    // And subsequent sendMessage should now write to stdin again.
    proc.stdin.write.mockClear()
    manager.sendMessage(sessionId, 'next turn please')
    expect(proc.stdin.write).toHaveBeenCalled()
  })

  it('skips spawn and emits error when probe rejects', async () => {
    mockTransport.probe = vi.fn(async () => ({ ok: false as const, reason: 'no claude' }))
    await manager.startSession(makeEnv(), makeProject())
    expect(mockTransport.spawn).not.toHaveBeenCalled()
    expect(onEvent).toHaveBeenCalledWith(
      'session:status',
      expect.objectContaining({ status: 'error', errorMessage: 'no claude' })
    )
  })
})
