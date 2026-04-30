import { describe, it, expect, beforeAll } from 'vitest'
import { spawn } from 'node:child_process'
import { SessionManager } from '../../src/main/session-manager'
import { initProviders } from '../../src/main/providers/init'
import type { Environment, Project } from '../../src/shared/types'
import type { NormalizedEvent } from '../../src/shared/events'

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
  it('emits normalized events from mock claude (session.started → turn → completed)', async () => {
    const received: { channel: string; payload: unknown }[] = []

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

    await new Promise(resolve => setTimeout(resolve, 200))
    manager.sendMessage(sessionId, 'hello')

    await new Promise(resolve => setTimeout(resolve, 500))

    const eventKinds = received
      .filter(r => r.channel === 'session:event')
      .flatMap(r => (r.payload as { events: NormalizedEvent[] }).events.map(e => e.kind))

    expect(eventKinds).toContain('session.started')
    expect(eventKinds).toContain('turn.started')
    expect(eventKinds).toContain('item.started')
    expect(eventKinds).toContain('turn.completed')

    const statusChanges = received
      .filter(r => r.channel === 'session:status')
      .map(r => (r.payload as { status: string }).status)

    expect(statusChanges).toContain('starting')
    expect(statusChanges).toContain('ready')
  })
})
