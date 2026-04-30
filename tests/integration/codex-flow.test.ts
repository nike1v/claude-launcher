import { describe, it, expect, beforeAll } from 'vitest'
import { spawn } from 'node:child_process'
import { SessionManager } from '../../src/main/session-manager'
import { initProviders } from '../../src/main/providers/init'
import type { Environment, Project } from '../../src/shared/types'
import type { NormalizedEvent } from '../../src/shared/events'

// Full SessionManager + CodexAdapter integration against a mock codex
// binary (tests/integration/mock-codex.sh). Verifies the JSON-RPC
// handshake, queue draining, and notification translation all wire up
// in a real spawn / pipe / IPC flow — without needing a real codex CLI
// on the test runner.

const mockEnv: Environment = {
  id: 'env-1',
  name: 'Test Codex',
  config: { kind: 'wsl', distro: 'Ubuntu' },
  providerKind: 'codex'
}

const mockProject: Project = {
  id: 'proj-1',
  name: 'Test',
  environmentId: 'env-1',
  path: '/tmp',
  providerKind: 'codex'
}

beforeAll(() => {
  initProviders()
})

describe('SessionManager × CodexAdapter integration (mock binary)', () => {
  it('walks the full bootstrap → user turn → assistant reply flow', async () => {
    const received: { channel: string; payload: unknown }[] = []

    const mockTransport = {
      // Spawn the bash mock as if it were `codex app-server`. Stdio
      // gets piped exactly like the real spawn, which is the whole
      // point of running through the SessionManager.
      spawn: () => spawn('bash', ['tests/integration/mock-codex.sh'], {
        stdio: ['pipe', 'pipe', 'pipe']
      }),
      probe: async () => ({ ok: true as const, version: 'codex 0.0.0 (mock)' })
    }

    const manager = new SessionManager(
      () => mockTransport as never,
      (channel, payload) => received.push({ channel, payload })
    )

    const sessionId = await manager.startSession(mockEnv, mockProject)

    // Give the bootstrap chain time to play out (initialize →
    // initialized → thread/start) before sending the user message.
    // The mock's internal `read` calls block until our writes arrive.
    await new Promise(resolve => setTimeout(resolve, 200))
    manager.sendMessage(sessionId, 'hello mock')

    // Wait for the mock to finish streaming the response + the trailing
    // sleep before checking what landed on the IPC channel.
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
    expect(kinds).toContain('item.completed')
    expect(kinds).toContain('turn.completed')

    // Reconstruct the streamed assistant text — should be the two
    // deltas from the mock concatenated.
    const text = allEvents
      .filter(e => e.kind === 'content.delta' && e.streamKind === 'assistant_text')
      .map(e => (e as Extract<NormalizedEvent, { kind: 'content.delta' }>).text)
      .join('')
    expect(text).toBe('Hello from mock codex.')

    // session:status flips to busy on turn.started, back to ready on
    // turn.completed — same contract as claude.
    const statusChanges = received
      .filter(r => r.channel === 'session:status')
      .map(r => (r.payload as { status: string }).status)
    expect(statusChanges).toContain('starting')
    expect(statusChanges).toContain('ready')
    expect(statusChanges).toContain('busy')
  }, 5000)
})
