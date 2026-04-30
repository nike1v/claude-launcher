import { describe, it, expect } from 'vitest'
import { CodexAdapter } from '../../src/main/providers/codex/adapter'
import type { NormalizedEvent } from '../../src/shared/events'

// Helpers — feed JSON-RPC messages through parseChunk as NDJSON.
function feed(adapter: CodexAdapter, ...messages: object[]): NormalizedEvent[] {
  const wire = messages.map(m => JSON.stringify(m)).join('\n') + '\n'
  return adapter.parseChunk(wire)
}

// Pull the first JSON-RPC message out of a stdin write blob (NDJSON).
function firstMessage(wire: string): Record<string, unknown> | null {
  const line = wire.split('\n').find(l => l.trim().length > 0)
  if (!line) return null
  return JSON.parse(line) as Record<string, unknown>
}

describe('CodexAdapter — bootstrap handshake', () => {
  it('writes an `initialize` request on startup', () => {
    const adapter = new CodexAdapter()
    const startup = adapter.startupBytes({ cwd: '/srv', model: 'gpt-5-codex' })
    const msg = firstMessage(startup)
    expect(msg).toMatchObject({ method: 'initialize', id: 1 })
    expect(msg!.params).toMatchObject({
      clientInfo: expect.objectContaining({ name: 'claude-launcher' })
    })
  })

  it('queues `initialized` + `thread/start` after the initialize response', () => {
    const adapter = new CodexAdapter()
    adapter.startupBytes({ cwd: '/srv', model: 'gpt-5-codex' })
    feed(adapter, {
      id: 1,
      result: { userAgent: 'codex/x', codexHome: '~/.codex' }
    })
    const queued = adapter.drainPendingWrites()
    const lines = queued.split('\n').filter(Boolean).map(l => JSON.parse(l))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({ method: 'initialized', params: {} })
    expect(lines[1]).toMatchObject({
      method: 'thread/start',
      params: { cwd: '/srv', model: 'gpt-5-codex' }
    })
  })

  it('issues `thread/resume` when resumeRef is set', () => {
    const adapter = new CodexAdapter()
    adapter.startupBytes({ cwd: '/srv', resumeRef: 'thr_42' })
    feed(adapter, { id: 1, result: { userAgent: 'codex/x' } })
    const queued = adapter.drainPendingWrites()
    const requestLine = queued.split('\n').filter(Boolean).map(l => JSON.parse(l)).find(m => m.method === 'thread/resume')
    expect(requestLine).toMatchObject({
      method: 'thread/resume',
      params: { threadId: 'thr_42' }
    })
  })

  it('emits session.started + session.stateChanged from the `thread/started` notification', () => {
    const adapter = new CodexAdapter()
    adapter.startupBytes({ cwd: '/srv' })
    const events = feed(adapter, {
      method: 'thread/started',
      params: { thread: { id: 'thr_1', model: 'gpt-5-codex', cwd: '/srv' } }
    })
    expect(events[0]).toEqual({
      kind: 'session.started',
      sessionRef: 'thr_1',
      model: 'gpt-5-codex',
      cwd: '/srv'
    })
    expect(events[1]).toEqual({ kind: 'session.stateChanged', state: 'ready' })
  })

  it('fails gracefully when initialize errors out', () => {
    const adapter = new CodexAdapter()
    adapter.startupBytes({ cwd: '/srv' })
    const events = feed(adapter, {
      id: 1,
      error: { code: -32700, message: 'broken' }
    })
    const err = events.find(e => e.kind === 'error')
    expect(err).toMatchObject({ class: 'provider_error', message: expect.stringContaining('initialize') })
  })
})

describe('CodexAdapter — formatUserMessage', () => {
  it('emits `turn/start` once the threadId is known', () => {
    const adapter = new CodexAdapter()
    adapter.startupBytes({ cwd: '/srv', model: 'gpt-5-codex' })
    feed(adapter, { id: 1, result: {} })
    feed(adapter, { id: 2, result: { thread: { id: 'thr_1' } } })

    const wire = adapter.formatUserMessage('hello', [])
    const msg = firstMessage(wire)
    expect(msg).toMatchObject({
      method: 'turn/start',
      params: {
        threadId: 'thr_1',
        input: [{ type: 'text', text: 'hello' }]
      }
    })
  })

  it('queues the user message during bootstrap and flushes it after thread/start', () => {
    const adapter = new CodexAdapter()
    adapter.startupBytes({ cwd: '/srv' })

    // User types a message before the bootstrap chain has finished.
    const eagerWire = adapter.formatUserMessage('eager', [])
    expect(eagerWire).toBe('') // queued, not returned

    // initialize response → triggers initialized + thread/start (id=2).
    feed(adapter, { id: 1, result: {} })
    // thread/start response (id=2) carries the real threadId; the
    // queued user message is flushed as a turn/start with it.
    feed(adapter, { id: 2, result: { thread: { id: 'thr_1' } } })

    const drained = adapter.drainPendingWrites()
    const lines = drained.split('\n').filter(Boolean).map(l => JSON.parse(l))

    // Wire order matters: thread/start must precede the turn/start so
    // codex sees the thread before we try to spawn a turn on it.
    const threadStartIdx = lines.findIndex(m => m.method === 'thread/start')
    const turnStartIdx = lines.findIndex(m => m.method === 'turn/start')
    expect(threadStartIdx).toBeGreaterThanOrEqual(0)
    expect(turnStartIdx).toBeGreaterThan(threadStartIdx)

    const turnStart = lines[turnStartIdx]
    expect(turnStart.params.threadId).toBe('thr_1')
    expect(turnStart.params.input).toEqual([{ type: 'text', text: 'eager' }])
  })

  it('inlines image attachments as data URLs', () => {
    const adapter = readyAdapter()
    const wire = adapter.formatUserMessage('look', [
      { kind: 'image', mediaType: 'image/png', data: 'AAA=' }
    ])
    const msg = firstMessage(wire)!
    const input = (msg.params as { input: object[] }).input
    expect(input).toContainEqual({
      type: 'image',
      url: 'data:image/png;base64,AAA='
    })
  })
})

describe('CodexAdapter — formatControl', () => {
  it('builds a `turn/interrupt` request with the active threadId / turnId', () => {
    const adapter = readyAdapter()
    feed(adapter, {
      method: 'turn/started',
      params: { turn: { id: 'turn_1' } }
    })
    const wire = adapter.formatControl({ kind: 'interrupt' })
    expect(wire).not.toBeNull()
    const msg = firstMessage(wire!)!
    expect(msg).toMatchObject({
      method: 'turn/interrupt',
      params: { threadId: 'thr_1', turnId: 'turn_1' }
    })
  })

  it('returns null for interrupt when no turn is active', () => {
    const adapter = readyAdapter()
    expect(adapter.formatControl({ kind: 'interrupt' })).toBeNull()
  })

  it('replies to a server-side commandExecution approval prompt', () => {
    const adapter = readyAdapter()
    // Server requests approval.
    feed(adapter, {
      id: 'srv-1',
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thr_1', turnId: 't_1', itemId: 'it_1', command: 'ls' }
    })
    const wire = adapter.formatControl({
      kind: 'approval',
      requestId: 'srv-1',
      decision: 'accept'
    })
    const msg = firstMessage(wire!)
    expect(msg).toMatchObject({ id: 'srv-1', result: { decision: 'approved' } })
  })

  it('uses fileChange-flavoured decisions for the file approval flow', () => {
    const adapter = readyAdapter()
    feed(adapter, {
      id: 'srv-2',
      method: 'item/fileChange/requestApproval',
      params: { itemId: 'it_2' }
    })
    const wire = adapter.formatControl({
      kind: 'approval',
      requestId: 'srv-2',
      decision: 'acceptForSession'
    })
    const msg = firstMessage(wire!)
    expect(msg).toMatchObject({ result: { decision: 'approve_for_session' } })
  })
})

describe('CodexAdapter — notification translation', () => {
  it('translates an agentMessage delta into a content.delta event', () => {
    const adapter = readyAdapter()
    feed(adapter, {
      method: 'item/started',
      params: {
        turnId: 't_1',
        item: { id: 'i_1', type: 'agentMessage' }
      }
    })
    const events = feed(adapter, {
      method: 'item/agentMessage/delta',
      params: { itemId: 'i_1', delta: 'partial response' }
    })
    expect(events[0]).toEqual({
      kind: 'content.delta',
      itemId: 'i_1',
      streamKind: 'assistant_text',
      text: 'partial response'
    })
  })

  it('translates a commandExecution outputDelta into command_output content', () => {
    const adapter = readyAdapter()
    const events = feed(adapter, {
      method: 'item/commandExecution/outputDelta',
      params: { itemId: 'i_2', chunk: 'line\n' }
    })
    expect(events[0]).toMatchObject({
      streamKind: 'command_output',
      text: 'line\n'
    })
  })

  it('opens an approval request as request.opened with the right requestType', () => {
    const adapter = readyAdapter()
    const events = feed(adapter, {
      id: 'srv-99',
      method: 'item/commandExecution/requestApproval',
      params: { itemId: 'it_99', command: 'rm -rf /' }
    })
    expect(events[0]).toMatchObject({
      kind: 'request.opened',
      requestType: 'command_approval',
      requestId: 'srv-99',
      itemId: 'it_99'
    })
  })

  it('emits turn.completed on `turn/completed`', () => {
    const adapter = readyAdapter()
    feed(adapter, {
      method: 'turn/started',
      params: { turn: { id: 't_77' } }
    })
    const events = feed(adapter, {
      method: 'turn/completed',
      params: { turn: { id: 't_77' } }
    })
    expect(events[0]).toEqual({
      kind: 'turn.completed',
      turnId: 't_77',
      status: 'completed'
    })
  })
})

// ── helpers ────────────────────────────────────────────────────────────

// A CodexAdapter that's gone through the bootstrap dance and is ready
// to send turns. threadId is 'thr_1'.
function readyAdapter(): CodexAdapter {
  const adapter = new CodexAdapter()
  adapter.startupBytes({ cwd: '/srv', model: 'gpt-5-codex' })
  feed(adapter, { id: 1, result: {} })
  feed(adapter, { id: 2, result: { thread: { id: 'thr_1' } } })
  feed(adapter, {
    method: 'thread/started',
    params: { thread: { id: 'thr_1' } }
  })
  // drain any queued bytes from bootstrap so they don't leak into
  // assertions on subsequent calls
  adapter.drainPendingWrites()
  return adapter
}
