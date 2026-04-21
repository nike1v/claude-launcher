import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { SessionManager } from '../../src/main/session-manager'
import type { Project, StreamJsonEvent } from '../../src/shared/types'

const mockProject: Project = {
  id: 'proj-1',
  name: 'Test',
  host: { kind: 'wsl', distro: 'Ubuntu' },
  path: '/tmp'
}

describe('SessionManager integration (mock transport)', () => {
  it('emits init, assistant, and result events from mock claude', async () => {
    const received: { channel: string; payload: unknown }[] = []

    // Mock transport spawns our bash script directly
    const mockTransport = {
      spawn: () => spawn('bash', ['tests/integration/mock-claude.sh'], {
        stdio: ['pipe', 'pipe', 'pipe']
      })
    }

    const manager = new SessionManager(
      () => mockTransport as any,
      (channel, payload) => received.push({ channel, payload })
    )

    const sessionId = manager.startSession(mockProject)

    // Send a user message to unblock the script's `read`
    await new Promise(resolve => setTimeout(resolve, 200))
    manager.sendMessage(sessionId, 'hello')

    // Wait for the script to finish
    await new Promise(resolve => setTimeout(resolve, 500))

    const eventChannels = received.filter(r => r.channel === 'session:event')
    const types = eventChannels.map(r => (r.payload as { event: StreamJsonEvent }).event.type)

    expect(types).toContain('system')
    expect(types).toContain('assistant')
    expect(types).toContain('result')

    const statusChanges = received
      .filter(r => r.channel === 'session:status')
      .map(r => (r.payload as { status: string }).status)

    expect(statusChanges).toContain('starting')
    expect(statusChanges).toContain('ready')
  })
})
