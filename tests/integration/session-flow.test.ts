import { describe, it, expect, beforeAll } from 'vitest'
import { spawn } from 'node:child_process'
import { SessionManager } from '../../src/main/session-manager'
import { initProviders } from '../../src/main/providers/init'
import type { Environment, Project, StreamJsonEvent } from '../../src/shared/types'

const mockEnv: Environment = {
  id: 'env-1',
  name: 'Test WSL',
  config: { kind: 'wsl', distro: 'Ubuntu' }
}

const mockProject: Project = {
  id: 'proj-1',
  name: 'Test',
  environmentId: 'env-1',
  path: '/tmp'
}

beforeAll(() => {
  // SessionManager.startSession resolves a provider from the registry —
  // wire claude in once before the suite runs.
  initProviders()
})

describe('SessionManager integration (mock transport)', () => {
  it('emits init, assistant, and result events from mock claude', async () => {
    const received: { channel: string; payload: unknown }[] = []

    // Mock transport spawns our bash script directly
    const mockTransport = {
      spawn: () => spawn('bash', ['tests/integration/mock-claude.sh'], {
        stdio: ['pipe', 'pipe', 'pipe']
      }),
      probe: async () => ({ ok: true as const, version: '0.0.0 (Claude Code mock)' })
    }

    const manager = new SessionManager(
      () => mockTransport as any,
      (channel, payload) => received.push({ channel, payload })
    )

    const sessionId = await manager.startSession(mockEnv, mockProject)

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
