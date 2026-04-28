import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { SessionManager } from '../../src/main/session-manager'
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

  it('emits parsed stream-json events from stdout', async () => {
    const sessionId = await manager.startSession(makeEnv(), makeProject())
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

    expect(onEvent).toHaveBeenCalledWith(
      'session:event',
      expect.objectContaining({
        sessionId,
        event: expect.objectContaining({ type: 'assistant' })
      })
    )
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
