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

  it('first interrupt writes a control_request/interrupt JSON line to stdin and does NOT kill the process', async () => {
    // Regression for the v0.4.4 bug report: signalling the child on
    // Windows / WSL / SSH tore down the transport (wsl.exe / ssh.exe) and
    // closed the chat, instead of just aborting the in-flight claude turn.
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

  it('second interrupt while soft is in flight escalates straight to SIGTERM', async () => {
    // The user's "I clicked stop and nothing happened, click it again"
    // path. Skip the auto-escalation wait and SIGTERM immediately so the
    // user gets out fast on a wedged session.
    const sessionId = await manager.startSession(makeEnv(), makeProject())
    const proc = mockTransport.spawn.mock.results[0].value
    manager.interruptSession(sessionId)
    expect(proc.kill).not.toHaveBeenCalled()
    manager.interruptSession(sessionId)
    expect(proc.kill).toHaveBeenCalledOnce()
    // Default kill() — SIGTERM, not SIGKILL yet. Force is reserved for
    // the third click / second-tier watchdog.
    expect(proc.kill).toHaveBeenCalledWith()
  })

  it('third interrupt escalates from SIGTERM to SIGKILL', async () => {
    const sessionId = await manager.startSession(makeEnv(), makeProject())
    const proc = mockTransport.spawn.mock.results[0].value
    manager.interruptSession(sessionId) // soft
    manager.interruptSession(sessionId) // hard (SIGTERM)
    manager.interruptSession(sessionId) // force (SIGKILL)
    expect(proc.kill).toHaveBeenCalledTimes(2)
    expect(proc.kill).toHaveBeenLastCalledWith('SIGKILL')
  })

  it('soft watchdog auto-escalates to SIGTERM when no turn.completed lands', async () => {
    // The wedged-claude case (auto-compact, hung tool call) — the
    // in-band interrupt is sent but never honoured. After the soft
    // window the watchdog fires and SIGTERMs the child so the user
    // isn't stranded.
    vi.useFakeTimers()
    try {
      const sessionId = await manager.startSession(makeEnv(), makeProject())
      const proc = mockTransport.spawn.mock.results[0].value
      manager.interruptSession(sessionId)
      vi.advanceTimersByTime(5000) // SOFT_INTERRUPT_TIMEOUT_MS
      expect(proc.kill).toHaveBeenCalledOnce()
      expect(proc.kill).toHaveBeenCalledWith()
    } finally {
      vi.useRealTimers()
    }
  })

  it('hard watchdog auto-escalates to SIGKILL when SIGTERM doesn\'t land', async () => {
    vi.useFakeTimers()
    try {
      const sessionId = await manager.startSession(makeEnv(), makeProject())
      const proc = mockTransport.spawn.mock.results[0].value
      manager.interruptSession(sessionId)
      vi.advanceTimersByTime(5000) // soft → hard (SIGTERM)
      vi.advanceTimersByTime(3000) // hard → force (SIGKILL)
      expect(proc.kill).toHaveBeenCalledTimes(2)
      expect(proc.kill).toHaveBeenLastCalledWith('SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })

  it('turn.completed clears the interrupt phase so the next click starts soft again', async () => {
    vi.useFakeTimers()
    try {
      const sessionId = await manager.startSession(makeEnv(), makeProject())
      const proc = mockTransport.spawn.mock.results[0].value

      // Open a turn first — claude-adapter only emits turn.completed
      // when there's an open turn to close.
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

      // Provider honours the interrupt — emit a result event to close
      // the open turn (claude-adapter produces turn.completed).
      const resultLine = JSON.stringify({
        type: 'result',
        subtype: 'success',
        session_id: 'sess-1',
        is_error: false,
        num_turns: 1
      })
      proc.stdout.emit('data', Buffer.from(resultLine + '\n'))

      // Watchdog should be cleared, no kill issued even past timeout.
      vi.advanceTimersByTime(15000)
      expect(proc.kill).not.toHaveBeenCalled()

      // Phase is reset — a fresh interrupt starts at 'soft' again, not
      // jumps to 'hard'. Verify by clicking once more and checking kill
      // didn't fire (soft phase is in-band only).
      manager.interruptSession(sessionId)
      expect(proc.kill).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
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
