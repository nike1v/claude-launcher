import { describe, it, expect } from 'vitest'
import { AcpAdapter } from '../../src/main/providers/acp/adapter'
import type { NormalizedEvent } from '../../src/shared/events'

// AcpAdapter unit tests — synthetic JSON-RPC over the protocol.
// Same shape as codex-adapter tests; AcpAdapter is shared between
// cursor and opencode flavors.

function feed(adapter: AcpAdapter, ...messages: object[]): NormalizedEvent[] {
  const wire = messages.map(m => JSON.stringify(m)).join('\n') + '\n'
  return adapter.parseChunk(wire)
}

function firstMessage(wire: string): Record<string, unknown> | null {
  const line = wire.split('\n').find(l => l.trim().length > 0)
  if (!line) return null
  return JSON.parse(line) as Record<string, unknown>
}

function allMessages(wire: string): Record<string, unknown>[] {
  return wire.split('\n').filter(Boolean).map(l => JSON.parse(l))
}

describe('AcpAdapter — bootstrap handshake (cursor flavor)', () => {
  it('sends initialize on startup with protocolVersion 1', () => {
    const adapter = new AcpAdapter('cursor')
    const startup = adapter.startupBytes({ cwd: '/srv', model: 'claude-3.5-sonnet' })
    const msg = firstMessage(startup)
    expect(msg).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: expect.objectContaining({ protocolVersion: 1 })
    })
  })

  it('queues authenticate (cursor_login) after the initialize response', () => {
    const adapter = new AcpAdapter('cursor')
    adapter.startupBytes({ cwd: '/srv' })
    feed(adapter, {
      jsonrpc: '2.0', id: 1,
      result: { protocolVersion: 1, authMethods: [{ id: 'cursor_login' }, { id: 'other' }], agentCapabilities: {} }
    })
    const queued = adapter.drainPendingWrites()
    const auth = firstMessage(queued)
    expect(auth).toMatchObject({
      method: 'authenticate',
      params: { methodId: 'cursor_login' }
    })
  })

  it('queues session/new after authenticate response (fresh session)', () => {
    const adapter = new AcpAdapter('cursor')
    adapter.startupBytes({ cwd: '/srv' })
    feed(adapter, { jsonrpc: '2.0', id: 1, result: { authMethods: [{ id: 'cursor_login' }] } })
    feed(adapter, { jsonrpc: '2.0', id: 2, result: null })
    const queued = adapter.drainPendingWrites()
    const newSession = allMessages(queued).find(m => m.method === 'session/new')
    expect(newSession).toMatchObject({
      method: 'session/new',
      params: { cwd: '/srv', mcpServers: [] }
    })
  })

  it('queues session/load instead when resumeRef is set', () => {
    const adapter = new AcpAdapter('cursor')
    adapter.startupBytes({ cwd: '/srv', resumeRef: 'sess-existing' })
    feed(adapter, { jsonrpc: '2.0', id: 1, result: { authMethods: [{ id: 'cursor_login' }] } })
    feed(adapter, { jsonrpc: '2.0', id: 2, result: null })
    const queued = adapter.drainPendingWrites()
    const loadSession = allMessages(queued).find(m => m.method === 'session/load')
    expect(loadSession).toMatchObject({
      method: 'session/load',
      params: { sessionId: 'sess-existing' }
    })
  })

  it('emits session.started + session.stateChanged once session/new returns', () => {
    const adapter = new AcpAdapter('cursor')
    adapter.startupBytes({ cwd: '/srv', model: 'claude-3.5-sonnet' })
    feed(adapter, { jsonrpc: '2.0', id: 1, result: { authMethods: [{ id: 'cursor_login' }] } })
    feed(adapter, { jsonrpc: '2.0', id: 2, result: null })
    const events = feed(adapter, {
      jsonrpc: '2.0', id: 3,
      result: { sessionId: 'sess_new_1' }
    })
    expect(events[0]).toEqual({
      kind: 'session.started',
      sessionRef: 'sess_new_1',
      model: 'claude-3.5-sonnet',
      cwd: '/srv'
    })
    expect(events[1]).toEqual({ kind: 'session.stateChanged', state: 'ready' })
  })

  it('issues session/set_config_option for the model after session/new (cursor)', () => {
    const adapter = new AcpAdapter('cursor')
    adapter.startupBytes({ cwd: '/srv', model: 'claude-3.5-sonnet' })
    feed(adapter, { jsonrpc: '2.0', id: 1, result: { authMethods: [{ id: 'cursor_login' }] } })
    feed(adapter, { jsonrpc: '2.0', id: 2, result: null })
    feed(adapter, { jsonrpc: '2.0', id: 3, result: { sessionId: 'sess_1' } })
    const queued = adapter.drainPendingWrites()
    const setOption = allMessages(queued).find(m => m.method === 'session/set_config_option')
    expect(setOption).toMatchObject({
      method: 'session/set_config_option',
      params: { configId: 'model', value: 'claude-3.5-sonnet' }
    })
  })
})

describe('AcpAdapter — opencode flavor differences', () => {
  it('skips authenticate for opencode and goes straight to session/new', () => {
    // Repro for the v0.7.7 stall: opencode's `authenticate` returns
    // `{error: "Authentication not implemented"}` because auth is
    // configured externally (`opencode auth login`). The adapter must
    // not even *send* authenticate — go from initialize → session/new.
    const adapter = new AcpAdapter('opencode')
    adapter.startupBytes({ cwd: '/srv' })
    feed(adapter, {
      jsonrpc: '2.0', id: 1,
      result: { authMethods: [{ id: 'opencode-login' }] }
    })
    const queued = adapter.drainPendingWrites()
    const messages = allMessages(queued)
    expect(messages.find(m => m.method === 'authenticate')).toBeUndefined()
    expect(messages.find(m => m.method === 'session/new')).toMatchObject({
      method: 'session/new',
      params: { cwd: '/srv', mcpServers: [] }
    })
  })

  it('does NOT issue session/set_config_option for opencode', () => {
    const adapter = new AcpAdapter('opencode')
    adapter.startupBytes({ cwd: '/srv', model: 'gpt-4o' })
    feed(adapter, { jsonrpc: '2.0', id: 1, result: { authMethods: [{ id: 'oc' }] } })
    // No id:2 authenticate response — opencode skips authenticate.
    feed(adapter, { jsonrpc: '2.0', id: 2, result: { sessionId: 's' } })
    const queued = adapter.drainPendingWrites()
    expect(allMessages(queued).find(m => m.method === 'session/set_config_option')).toBeUndefined()
  })
})

describe('AcpAdapter — session/load history replay', () => {
  it('replays past user_message + agent_message + agent_thought without synthesizing a turn', () => {
    // Repro of the 0.7.10 stuck-thinking bug. opencode (and any
    // compliant ACP server) emits the loaded session's past messages
    // as session/update notifications BEFORE the load response. Our
    // adapter used to synthesize a turn.started for the first chunk
    // — which session-manager flipped to busy — and never close it,
    // leaving the spinner stuck.
    const adapter = new AcpAdapter('opencode')
    adapter.startupBytes({ cwd: '/srv', resumeRef: 'ses_old' })
    // initialize response
    feed(adapter, { jsonrpc: '2.0', id: 1, result: { authMethods: [{ id: 'opencode-login' }] } })
    // session/load is now in flight (opencode skips authenticate).
    // Replay the history before the load response lands.
    const replayEvents = feed(adapter,
      { jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'ses_old', update: { sessionUpdate: 'available_commands_update', availableCommands: [] } } },
      { jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'ses_old', update: { sessionUpdate: 'user_message_chunk', messageId: 'msg_user1', content: { type: 'text', text: 'hi' } } } },
      { jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'ses_old', update: { sessionUpdate: 'agent_thought_chunk', messageId: 'msg_agent1', content: { type: 'text', text: 'thinking…' } } } },
      { jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'ses_old', update: { sessionUpdate: 'agent_message_chunk', messageId: 'msg_agent1', content: { type: 'text', text: 'Hey!' } } } }
    )

    // No synthetic turn.started during replay.
    expect(replayEvents.find(e => e.kind === 'turn.started')).toBeUndefined()

    // User's past message rendered.
    const userItem = replayEvents.find(e => e.kind === 'item.started' && 'itemType' in e && e.itemType === 'user_message')
    expect(userItem).toMatchObject({
      kind: 'item.started',
      itemId: 'msg_user1',
      itemType: 'user_message',
      text: 'hi'
    })

    // Agent's past thought + message rendered as separate items.
    const reasoningItem = replayEvents.find(e => e.kind === 'item.started' && 'itemType' in e && e.itemType === 'reasoning')
    expect(reasoningItem).toBeDefined()
    const assistantItem = replayEvents.find(e => e.kind === 'item.started' && 'itemType' in e && e.itemType === 'assistant_message')
    expect(assistantItem).toBeDefined()
    // Assistant content delta carries the past reply text.
    const assistantDelta = replayEvents.find(e => e.kind === 'content.delta' && 'streamKind' in e && e.streamKind === 'assistant_text')
    expect(assistantDelta).toMatchObject({ text: 'Hey!' })

    // session/load response — replay phase ends, session becomes ready.
    const loadResponseEvents = feed(adapter, { jsonrpc: '2.0', id: 2, result: { sessionId: 'ses_old' } })
    expect(loadResponseEvents.find(e => e.kind === 'session.started')).toBeDefined()
    expect(loadResponseEvents.find(e => e.kind === 'session.stateChanged' && 'state' in e && e.state === 'ready')).toBeDefined()
  })

  it('falls back to session/new when session/load returns "session not found"', () => {
    // Cursor evicts old sessions — the saved sessionRef stops working
    // after the agent forgets it. Treat that specific error as
    // "expired" and start fresh instead of leaving the tab on a hard
    // error the user has to reset manually.
    const adapter = new AcpAdapter('cursor')
    adapter.startupBytes({ cwd: '/srv', resumeRef: 'sess-stale' })
    feed(adapter, { jsonrpc: '2.0', id: 1, result: { authMethods: [{ id: 'cursor_login' }] } })
    feed(adapter, { jsonrpc: '2.0', id: 2, result: null })
    // session/load fails with the cursor-style "Session not found".
    const events = feed(adapter, {
      jsonrpc: '2.0', id: 3,
      error: {
        code: -32602,
        message: 'Invalid params',
        data: { message: 'Session "sess-stale" not found' }
      }
    })
    // We surface a warning (not a hard error) and queue session/new.
    expect(events.find(e => e.kind === 'warning')).toBeDefined()
    const queued = adapter.drainPendingWrites()
    expect(allMessages(queued).find(m => m.method === 'session/new')).toMatchObject({
      method: 'session/new',
      params: { cwd: '/srv', mcpServers: [] }
    })
  })
})

describe('AcpAdapter — formatUserMessage', () => {
  it('emits session/prompt once session is ready', () => {
    const adapter = readyAdapter()
    const wire = adapter.formatUserMessage('hello acp', [])
    const msg = firstMessage(wire)!
    expect(msg).toMatchObject({
      method: 'session/prompt',
      params: {
        sessionId: 'sess_1',
        prompt: [{ type: 'text', text: 'hello acp' }]
      }
    })
  })

  it('queues messages typed during bootstrap and flushes after session/new', () => {
    const adapter = new AcpAdapter('cursor')
    adapter.startupBytes({ cwd: '/srv' })
    expect(adapter.formatUserMessage('eager', [])).toBe('')
    feed(adapter, { jsonrpc: '2.0', id: 1, result: { authMethods: [{ id: 'cursor_login' }] } })
    feed(adapter, { jsonrpc: '2.0', id: 2, result: null })
    feed(adapter, { jsonrpc: '2.0', id: 3, result: { sessionId: 'sess_1' } })
    const queued = adapter.drainPendingWrites()
    const prompt = allMessages(queued).find(m => m.method === 'session/prompt')
    expect(prompt).toMatchObject({
      params: {
        sessionId: 'sess_1',
        prompt: [{ type: 'text', text: 'eager' }]
      }
    })
  })

  it('encodes image attachments as ACP image content blocks', () => {
    const adapter = readyAdapter()
    const wire = adapter.formatUserMessage('look', [
      { kind: 'image', mediaType: 'image/png', data: 'AAA=' }
    ])
    const msg = firstMessage(wire)!
    const prompt = (msg.params as { prompt: object[] }).prompt
    expect(prompt).toContainEqual({ type: 'image', data: 'AAA=', mimeType: 'image/png' })
  })
})

describe('AcpAdapter — formatControl', () => {
  it('cancel sends a session/cancel notification (no id)', () => {
    const adapter = readyAdapter()
    const wire = adapter.formatControl({ kind: 'interrupt' })
    expect(wire).not.toBeNull()
    const msg = firstMessage(wire!)!
    expect(msg).toMatchObject({
      method: 'session/cancel',
      params: { sessionId: 'sess_1' }
    })
    expect(msg.id).toBeUndefined()
  })

  it('approval reply maps decisions onto the offered option ids by kind', () => {
    const adapter = readyAdapter()
    feed(adapter, {
      jsonrpc: '2.0', id: 'srv-1', method: 'session/request_permission',
      params: {
        sessionId: 'sess_1',
        toolCall: { toolCallId: 'tc_1', kind: 'execute' },
        options: [
          { optionId: 'a1', name: 'Allow', kind: 'allow_once' },
          { optionId: 'a2', name: 'Always allow', kind: 'allow_always' },
          { optionId: 'r1', name: 'Reject', kind: 'reject_once' }
        ]
      }
    })

    const acceptWire = adapter.formatControl({
      kind: 'approval', requestId: 'srv-1', decision: 'accept'
    })
    const accept = firstMessage(acceptWire!)!
    expect(accept).toMatchObject({
      id: 'srv-1',
      result: { outcome: { outcome: 'selected', selectedOptionId: 'a1' } }
    })
  })

  it('approval acceptForSession picks allow_always option', () => {
    const adapter = readyAdapter()
    feed(adapter, {
      jsonrpc: '2.0', id: 'srv-2', method: 'session/request_permission',
      params: {
        sessionId: 'sess_1',
        toolCall: { toolCallId: 'tc_2', kind: 'edit' },
        options: [
          { optionId: 'a1', kind: 'allow_once' },
          { optionId: 'a2', kind: 'allow_always' }
        ]
      }
    })
    const wire = adapter.formatControl({
      kind: 'approval', requestId: 'srv-2', decision: 'acceptForSession'
    })
    const msg = firstMessage(wire!)!
    expect((msg.result as { outcome: { selectedOptionId: string } }).outcome.selectedOptionId).toBe('a2')
  })

  it('cancel decision returns outcome:"cancelled"', () => {
    const adapter = readyAdapter()
    feed(adapter, {
      jsonrpc: '2.0', id: 'srv-3', method: 'session/request_permission',
      params: { sessionId: 'sess_1', toolCall: { toolCallId: 'tc' }, options: [] }
    })
    const wire = adapter.formatControl({
      kind: 'approval', requestId: 'srv-3', decision: 'cancel'
    })
    const msg = firstMessage(wire!)!
    expect(msg.result).toEqual({ outcome: { outcome: 'cancelled' } })
  })
})

describe('AcpAdapter — session/update notifications', () => {
  it('reassembles agent_message_chunk deltas under one assistant item', () => {
    const adapter = readyAdapter()
    const events: NormalizedEvent[] = []
    events.push(...feed(adapter, {
      jsonrpc: '2.0', method: 'session/update',
      params: {
        sessionId: 'sess_1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello, ' } }
      }
    }))
    events.push(...feed(adapter, {
      jsonrpc: '2.0', method: 'session/update',
      params: {
        sessionId: 'sess_1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world.' } }
      }
    }))
    const itemStart = events.find(e => e.kind === 'item.started' && e.itemType === 'assistant_message')
    expect(itemStart).toBeDefined()
    const deltas = events.filter(e => e.kind === 'content.delta')
    expect(deltas).toHaveLength(2)
    expect(deltas.map(d => (d as Extract<NormalizedEvent, { kind: 'content.delta' }>).text).join(''))
      .toBe('Hello, world.')
  })

  it('translates a tool_call notification with kind=execute into a command_execution item', () => {
    const adapter = readyAdapter()
    const events = feed(adapter, {
      jsonrpc: '2.0', method: 'session/update',
      params: {
        sessionId: 'sess_1',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc_run',
          title: 'ls',
          kind: 'execute',
          rawInput: { command: 'ls -la' }
        }
      }
    })
    const start = events.find(e => e.kind === 'item.started')
    expect(start).toMatchObject({
      itemType: 'command_execution',
      command: 'ls -la'
    })
  })

  it('translates a tool_call_update with status=completed into item.completed', () => {
    const adapter = readyAdapter()
    feed(adapter, {
      jsonrpc: '2.0', method: 'session/update',
      params: {
        sessionId: 'sess_1',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc_search',
          title: 'search',
          kind: 'search',
          rawInput: { q: 'foo' }
        }
      }
    })
    const events = feed(adapter, {
      jsonrpc: '2.0', method: 'session/update',
      params: {
        sessionId: 'sess_1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc_search',
          status: 'completed',
          rawOutput: '3 hits'
        }
      }
    })
    const completed = events.find(e => e.kind === 'item.completed')
    expect(completed).toMatchObject({
      itemId: 'tc_search',
      status: 'completed',
      output: '3 hits'
    })
  })

  it('translates opencode usage_update into tokenUsage.updated', () => {
    const adapter = readyAdapter('opencode')
    const events = feed(adapter, {
      jsonrpc: '2.0', method: 'session/update',
      params: {
        sessionId: 'sess_1',
        update: { sessionUpdate: 'usage_update', used: 1500, size: 200000 }
      }
    })
    const usage = events.find(e => e.kind === 'tokenUsage.updated')
    expect(usage).toMatchObject({
      usage: { inputTokens: 1500, contextWindow: 200000 }
    })
  })
})

describe('AcpAdapter — session/prompt response', () => {
  it('emits turn.completed with status=completed when the prompt response arrives', () => {
    const adapter = readyAdapter()
    // Trigger an item-started so a turn is open.
    feed(adapter, {
      jsonrpc: '2.0', method: 'session/update',
      params: {
        sessionId: 'sess_1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'reply' } }
      }
    })
    // Send a prompt to register the pending request.
    const wire = adapter.formatUserMessage('go', [])
    const promptMsg = firstMessage(wire)!
    const events = feed(adapter, {
      jsonrpc: '2.0', id: promptMsg.id, result: { stopReason: 'end_of_turn' }
    })
    const completed = events.find(e => e.kind === 'turn.completed')
    expect(completed).toMatchObject({ status: 'completed' })
  })

  it('emits turn.completed with status=interrupted when stopReason=cancelled', () => {
    const adapter = readyAdapter()
    feed(adapter, {
      jsonrpc: '2.0', method: 'session/update',
      params: {
        sessionId: 'sess_1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'partial' } }
      }
    })
    const wire = adapter.formatUserMessage('go', [])
    const promptMsg = firstMessage(wire)!
    const events = feed(adapter, {
      jsonrpc: '2.0', id: promptMsg.id, result: { stopReason: 'cancelled' }
    })
    const completed = events.find(e => e.kind === 'turn.completed')
    expect(completed).toMatchObject({ status: 'interrupted' })
  })
})

// ── helpers ────────────────────────────────────────────────────────────

function readyAdapter(flavor: 'cursor' | 'opencode' = 'cursor'): AcpAdapter {
  const adapter = new AcpAdapter(flavor)
  adapter.startupBytes({ cwd: '/srv', model: 'claude-3.5-sonnet' })
  feed(adapter, { jsonrpc: '2.0', id: 1, result: { authMethods: [{ id: flavor === 'cursor' ? 'cursor_login' : 'oc' }] } })
  feed(adapter, { jsonrpc: '2.0', id: 2, result: null })
  feed(adapter, { jsonrpc: '2.0', id: 3, result: { sessionId: 'sess_1' } })
  adapter.drainPendingWrites()
  return adapter
}
