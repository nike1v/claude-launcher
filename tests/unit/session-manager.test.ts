import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { SessionManager } from '../../src/main/session-manager'
import type { Project } from '../../src/shared/types'

const makeProcess = () => {
  const emitter = new EventEmitter()
  const stdinWritten: string[] = []
  return Object.assign(emitter, {
    pid: 42,
    stdin: {
      write: vi.fn((data: string) => stdinWritten.push(data)),
      end: vi.fn()
    },
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
    _written: stdinWritten
  })
}

const makeProject = (): Project => ({
  id: 'proj-1',
  name: 'Test',
  host: { kind: 'wsl', distro: 'Ubuntu' },
  path: '/tmp'
})

describe('SessionManager', () => {
  let mockTransport: { spawn: ReturnType<typeof vi.fn> }
  let manager: SessionManager
  let onEvent: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const proc = makeProcess()
    mockTransport = { spawn: vi.fn(() => proc) }
    onEvent = vi.fn()
    manager = new SessionManager(
      () => mockTransport as any,
      onEvent
    )
  })

  it('starts a session and returns session id', () => {
    const sessionId = manager.startSession(makeProject())
    expect(typeof sessionId).toBe('string')
    expect(sessionId.length).toBeGreaterThan(0)
    expect(mockTransport.spawn).toHaveBeenCalledOnce()
  })

  it('emits session:status starting on start', () => {
    manager.startSession(makeProject())
    expect(onEvent).toHaveBeenCalledWith(
      'session:status',
      expect.objectContaining({ status: 'starting' })
    )
  })

  it('sends message as JSON line to stdin', () => {
    const sessionId = manager.startSession(makeProject())
    manager.sendMessage(sessionId, 'hello')
    const proc = mockTransport.spawn.mock.results[0].value
    expect(proc.stdin.write).toHaveBeenCalledWith(
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }) + '\n'
    )
  })

  it('stops session and kills process', () => {
    const sessionId = manager.startSession(makeProject())
    manager.stopSession(sessionId)
    const proc = mockTransport.spawn.mock.results[0].value
    expect(proc.kill).toHaveBeenCalled()
    expect(onEvent).toHaveBeenCalledWith(
      'session:status',
      expect.objectContaining({ status: 'closed' })
    )
  })

  it('emits parsed stream-json events from stdout', () => {
    const sessionId = manager.startSession(makeProject())
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
})
