import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { SessionManager } from '../../src/main/session-manager'
import type { Environment, Project } from '../../src/shared/types'

const makeProcess = () => {
  const emitter = new EventEmitter()
  const stdinWritten: string[] = []
  const stdin = Object.assign(new EventEmitter(), {
    write: vi.fn((data: string) => stdinWritten.push(data)),
    end: vi.fn()
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
