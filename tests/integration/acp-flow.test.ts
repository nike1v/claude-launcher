import { describe, it, expect, beforeAll } from 'vitest'
import { spawn } from 'node:child_process'
import { SessionManager } from '../../src/main/session-manager'
import { initProviders } from '../../src/main/providers/init'
import type { Environment, Project } from '../../src/shared/types'
import type { NormalizedEvent } from '../../src/shared/events'

// Full SessionManager + AcpAdapter integration against a mock ACP
// server (tests/integration/mock-acp.sh). Same shape as
// codex-flow.test.ts — verifies the JSON-RPC handshake, the deferred
// flush of the user message after session/new, and notification
// translation all wire up under a real spawn / pipe / IPC flow.

const mockEnv: Environment = {
  id: 'env-1',
  name: 'Test Cursor',
  config: { kind: 'wsl', distro: 'Ubuntu' },
  providerKind: 'cursor'
}

const mockProject: Project = {
  id: 'proj-1',
  name: 'Test',
  environmentId: 'env-1',
  path: '/tmp',
  providerKind: 'cursor'
}

beforeAll(() => {
  initProviders()
})

describe('SessionManager × AcpAdapter integration (cursor flavor, mock binary)', () => {
  it('drives the full bootstrap → session/prompt → streamed reply flow', async () => {
    const received: { channel: string; payload: unknown }[] = []

    const mockTransport = {
      spawn: () => spawn('bash', ['tests/integration/mock-acp.sh'], {
        stdio: ['pipe', 'pipe', 'pipe']
      }),
      probe: async () => ({ ok: true as const, version: 'cursor-agent 0.0.0 (mock)' })
    }

    const manager = new SessionManager(
      () => mockTransport as never,
      (channel, payload) => received.push({ channel, payload })
    )

    const sessionId = await manager.startSession(mockEnv, mockProject)

    // The mock blocks waiting for our writes; give the bootstrap
    // chain time to play (initialize → authenticate → session/new
    // [→ session/set_config_option for cursor]) before the user
    // sends a prompt.
    await new Promise(resolve => setTimeout(resolve, 250))
    manager.sendMessage(sessionId, 'hello mock acp')

    // Wait for the mock to stream the reply + the trailing sleep
    // before checking what landed.
    await new Promise(resolve => setTimeout(resolve, 1000))

    const eventBatches = received.filter(r => r.channel === 'session:event')
    const allEvents: NormalizedEvent[] = []
    for (const batch of eventBatches) {
      const events = (batch.payload as { events: NormalizedEvent[] }).events
      allEvents.push(...events)
    }
    const kinds = allEvents.map(e => e.kind)

    expect(kinds).toContain('session.started')
    expect(kinds).toContain('turn.started')
    expect(kinds).toContain('item.started')
    expect(kinds).toContain('content.delta')
    expect(kinds).toContain('turn.completed')

    // Deltas reassemble into the streamed text from the mock.
    const text = allEvents
      .filter(e => e.kind === 'content.delta' && e.streamKind === 'assistant_text')
      .map(e => (e as Extract<NormalizedEvent, { kind: 'content.delta' }>).text)
      .join('')
    expect(text).toBe('Hello from mock acp.')

    const statusChanges = received
      .filter(r => r.channel === 'session:status')
      .map(r => (r.payload as { status: string }).status)
    expect(statusChanges).toContain('starting')
    expect(statusChanges).toContain('ready')
    expect(statusChanges).toContain('busy')
  }, 5000)
})
