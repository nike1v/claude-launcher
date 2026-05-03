import { describe, it, expect } from 'vitest'
import { ClaudeAdapter } from '../../src/main/providers/claude/adapter'
import type { NormalizedEvent } from '../../src/shared/events'

// Helpers — emit one stream-json line through parseChunk.
function feed(adapter: ClaudeAdapter, ...events: object[]): NormalizedEvent[] {
  return events.flatMap(e => adapter.parseChunk(JSON.stringify(e) + '\n'))
}

describe('ClaudeAdapter — system:init', () => {
  it('emits session.started + session.stateChanged(ready)', () => {
    const events = feed(new ClaudeAdapter(), {
      type: 'system',
      subtype: 'init',
      session_id: 'sess-1',
      model: 'claude-opus-4-7',
      cwd: '/srv/app',
      tools: [],
      mcp_servers: []
    })
    expect(events[0]).toEqual({
      kind: 'session.started',
      sessionRef: 'sess-1',
      model: 'claude-opus-4-7',
      cwd: '/srv/app'
    })
    expect(events[1]).toEqual({ kind: 'session.stateChanged', state: 'ready' })
  })
})

describe('ClaudeAdapter — assistant blocks', () => {
  it('translates a text block into item.started → content.delta → item.completed', () => {
    const events = feed(new ClaudeAdapter(), assistant([{ type: 'text', text: 'hello world' }]))

    // turn.started + tokenUsage.updated + (item triple)
    const itemTriple = events.filter(e => e.kind.startsWith('item.') || e.kind === 'content.delta')
    expect(itemTriple).toHaveLength(3)
    expect(itemTriple[0]).toMatchObject({ kind: 'item.started', itemType: 'assistant_message' })
    expect(itemTriple[1]).toMatchObject({ kind: 'content.delta', streamKind: 'assistant_text', text: 'hello world' })
    expect(itemTriple[2]).toMatchObject({ kind: 'item.completed', status: 'completed' })
  })

  it('skips empty text blocks', () => {
    const events = feed(new ClaudeAdapter(), assistant([{ type: 'text', text: '   ' }]))
    expect(events.some(e => e.kind === 'item.started')).toBe(false)
  })

  it('translates a thinking block into a reasoning item', () => {
    const events = feed(new ClaudeAdapter(), assistant([{ type: 'thinking', thinking: 'deep thoughts' }]))
    const itemStart = events.find(e => e.kind === 'item.started')
    expect(itemStart).toMatchObject({ itemType: 'reasoning' })
    const delta = events.find(e => e.kind === 'content.delta')
    expect(delta).toMatchObject({ streamKind: 'reasoning_text', text: 'deep thoughts' })
  })

  it('translates a tool_use block into a tool_use item with name + input', () => {
    const events = feed(new ClaudeAdapter(), assistant([
      { type: 'tool_use', id: 'tool-abc', name: 'Bash', input: { command: 'ls' } }
    ]))
    const itemStart = events.find(e => e.kind === 'item.started')
    expect(itemStart).toMatchObject({
      kind: 'item.started',
      itemId: 'tool-abc',
      itemType: 'tool_use',
      name: 'Bash',
      input: { command: 'ls' }
    })
    // tool_use waits for the matching tool_result before completing
    expect(events.some(e => e.kind === 'item.completed' && e.itemId === 'tool-abc')).toBe(false)
  })

  it('emits tokenUsage.updated with input + cache totals on each assistant', () => {
    const events = feed(new ClaudeAdapter(), assistant([{ type: 'text', text: 'hi' }], {
      input_tokens: 100,
      output_tokens: 5,
      cache_read_input_tokens: 50,
      cache_creation_input_tokens: 25
    }))
    const usage = events.find(e => e.kind === 'tokenUsage.updated')
    expect(usage).toMatchObject({
      kind: 'tokenUsage.updated',
      usage: { inputTokens: 100, outputTokens: 5, cachedInputTokens: 75 }
    })
  })

  it('opens a turn on the first assistant event and reuses it for subsequent ones', () => {
    const adapter = new ClaudeAdapter()
    const first = feed(adapter, assistant([{ type: 'text', text: 'a' }]))
    const second = feed(adapter, assistant([{ type: 'text', text: 'b' }]))
    const firstTurn = first.find(e => e.kind === 'turn.started')
    expect(firstTurn).toBeDefined()
    expect(second.some(e => e.kind === 'turn.started')).toBe(false)
  })
})

describe('ClaudeAdapter — tool_result pairing', () => {
  it('completes the matching tool_use item when the tool_result arrives', () => {
    const adapter = new ClaudeAdapter()
    feed(adapter, assistant([
      { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'echo hi' } }
    ]))
    const events = feed(adapter, {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'hi\n' }]
      }
    })
    const completed = events.find(e => e.kind === 'item.completed')
    expect(completed).toMatchObject({
      kind: 'item.completed',
      itemId: 'tool-1',
      status: 'completed',
      output: 'hi\n',
      isError: false
    })
  })

  it('flags is_error=true tool_results as failed', () => {
    const adapter = new ClaudeAdapter()
    feed(adapter, assistant([
      { type: 'tool_use', id: 'tool-2', name: 'Bash', input: {} }
    ]))
    const events = feed(adapter, {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-2', content: 'oops', is_error: true }]
      }
    })
    expect(events.find(e => e.kind === 'item.completed')).toMatchObject({
      status: 'failed',
      isError: true
    })
  })
})

describe('ClaudeAdapter — user echoes (live mode)', () => {
  it('drops a string-content user echo', () => {
    const events = feed(new ClaudeAdapter(), {
      type: 'user',
      message: { role: 'user', content: 'hello' }
    })
    // Live mode: no user_message item — InputBar already pushed one locally.
    expect(events.some(e => e.kind === 'item.started' && e.itemType === 'user_message')).toBe(false)
  })

  it('drops an array-content user echo with text + attachment', () => {
    const events = feed(new ClaudeAdapter(), {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'see this' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGk=' } }
        ]
      }
    })
    expect(events.some(e => e.kind === 'item.started' && e.itemType === 'user_message')).toBe(false)
  })
})

describe('ClaudeAdapter — replay mode (parseTranscript)', () => {
  it('emits user_message items for plain-text user lines', () => {
    const adapter = new ClaudeAdapter()
    const transcript = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'first prompt' }
    })
    const events = adapter.parseTranscript(transcript)
    const userItem = events.find(e => e.kind === 'item.started' && e.itemType === 'user_message')
    expect(userItem).toMatchObject({ kind: 'item.started', itemType: 'user_message', text: 'first prompt' })
  })

  it('emits user_message items for array content with text + image', () => {
    const transcript = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'look here' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGk=' } }
        ]
      }
    })
    const events = new ClaudeAdapter().parseTranscript(transcript)
    const userItem = events.find(e => e.kind === 'item.started' && e.itemType === 'user_message')
    expect(userItem).toMatchObject({
      itemType: 'user_message',
      text: 'look here'
    })
    expect((userItem as { attachments: unknown }).attachments).toBeDefined()
  })

  it('still pairs tool_results with their tool_use items in transcripts', () => {
    const lines = [
      JSON.stringify(assistant([
        { type: 'tool_use', id: 'tr-1', name: 'Bash', input: { command: 'ls' } }
      ])),
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tr-1', content: 'a b c' }]
        }
      })
    ].join('\n')
    const events = new ClaudeAdapter().parseTranscript(lines)
    expect(events.find(e => e.kind === 'item.completed' && e.itemId === 'tr-1'))
      .toMatchObject({ output: 'a b c', isError: false })
  })

  it('emits compact events for atomic blocks (text inline on item.started, no delta or completion)', () => {
    const transcript = JSON.stringify(assistant([
      { type: 'text', text: 'reply' },
      { type: 'thinking', thinking: 'pondering' }
    ]))
    const events = new ClaudeAdapter().parseTranscript(transcript)
    // Compact replay shape: one item.started per text/thinking block,
    // text inlined, no content.delta, no item.completed for them.
    const textItem = events.find(e => e.kind === 'item.started' && e.itemType === 'assistant_message')
    expect(textItem).toMatchObject({ itemType: 'assistant_message', text: 'reply' })
    const reasoningItem = events.find(e => e.kind === 'item.started' && e.itemType === 'reasoning')
    expect(reasoningItem).toMatchObject({ itemType: 'reasoning', text: 'pondering' })
    expect(events.some(e => e.kind === 'content.delta')).toBe(false)
    expect(events.some(e => e.kind === 'item.completed')).toBe(false)
  })

  it('skips turn / tokenUsage / session.stateChanged events in replay', () => {
    const lines = [
      JSON.stringify({
        type: 'system', subtype: 'init',
        session_id: 's', model: 'm', cwd: '/x', tools: [], mcp_servers: []
      }),
      JSON.stringify(assistant([{ type: 'text', text: 'hi' }])),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        session_id: 's',
        is_error: false,
        num_turns: 1,
        modelUsage: { 'claude-opus-4-7': { contextWindow: 200_000 } }
      })
    ].join('\n')
    const events = new ClaudeAdapter().parseTranscript(lines)
    const kinds = events.map(e => e.kind)
    expect(kinds).toContain('session.started')
    expect(kinds).not.toContain('session.stateChanged')
    expect(kinds).not.toContain('turn.started')
    expect(kinds).not.toContain('turn.completed')
    expect(kinds).not.toContain('tokenUsage.updated')
  })
})

describe('ClaudeAdapter — result event', () => {
  it('emits turn.completed and tokenUsage.updated with contextWindow', () => {
    const adapter = new ClaudeAdapter()
    feed(adapter, assistant([{ type: 'text', text: 'reply' }]))
    const events = feed(adapter, {
      type: 'result',
      subtype: 'success',
      session_id: 'sess-1',
      is_error: false,
      num_turns: 1,
      modelUsage: {
        'claude-opus-4-7': { contextWindow: 200_000, maxOutputTokens: 8_192 }
      }
    })
    expect(events.find(e => e.kind === 'tokenUsage.updated'))
      .toMatchObject({ usage: { contextWindow: 200_000 } })
    expect(events.find(e => e.kind === 'turn.completed'))
      .toMatchObject({ status: 'completed' })
  })

  // Regression: pre-fix the post-/compact result (no preceding assistant
  // event, num_turns: 0) left openTurnId null and translateResult became
  // a no-op — so session-manager never saw turn.completed and the UI
  // wedged on 'busy' until restart. Now we synth a turnId so the
  // busy→ready transition always fires when claude says it's done.
  it('emits turn.completed for a result with no preceding assistant event (post-/compact)', () => {
    const adapter = new ClaudeAdapter()
    const events = feed(adapter, {
      type: 'result',
      subtype: 'success',
      session_id: 'sess-compact',
      is_error: false,
      num_turns: 0
    })
    const turnEnd = events.find(e => e.kind === 'turn.completed')
    expect(turnEnd).toBeDefined()
    expect(turnEnd).toMatchObject({ status: 'completed' })
  })
})

describe('ClaudeAdapter — system.status (compacting)', () => {
  it('emits session.compactingChanged on entry and exit', () => {
    const adapter = new ClaudeAdapter()
    const enter = feed(adapter, {
      type: 'system',
      subtype: 'status',
      status: 'compacting'
    })
    expect(enter).toContainEqual({ kind: 'session.compactingChanged', isCompacting: true })

    const exit = feed(adapter, {
      type: 'system',
      subtype: 'status',
      status: null,
      compact_result: 'success'
    })
    expect(exit).toContainEqual({ kind: 'session.compactingChanged', isCompacting: false })
  })
})

describe('ClaudeAdapter — formatUserMessage', () => {
  const adapter = new ClaudeAdapter()

  it('emits a plain stream-json user line for text-only messages', () => {
    const line = adapter.formatUserMessage('hello', [])
    expect(line.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(line.trim())
    expect(parsed).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hello' }
    })
  })

  it('builds content blocks when image attachments are present', () => {
    const line = adapter.formatUserMessage('look', [
      { kind: 'image', mediaType: 'image/png', data: 'AAA=' }
    ])
    const parsed = JSON.parse(line.trim())
    expect(parsed.message.content[0]).toEqual({ type: 'text', text: 'look' })
    expect(parsed.message.content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAA=' }
    })
  })

  it('inlines text-file attachments as fenced code in the prelude', () => {
    const line = adapter.formatUserMessage('summarize', [
      { kind: 'text', name: 'notes.md', text: '# heading\nbody' }
    ])
    const parsed = JSON.parse(line.trim())
    const text = parsed.message.content[0].text
    expect(text).toContain('```md notes.md')
    expect(text).toContain('# heading')
    expect(text.endsWith('summarize')).toBe(true)
  })
})

describe('ClaudeAdapter — formatControl', () => {
  const adapter = new ClaudeAdapter()

  it('builds a control_request line for interrupt', () => {
    const line = adapter.formatControl({ kind: 'interrupt' })
    expect(line).not.toBeNull()
    const parsed = JSON.parse(line!.trim())
    expect(parsed.type).toBe('control_request')
    expect(parsed.request).toEqual({ subtype: 'interrupt' })
    expect(parsed.request_id).toMatch(/^req_/)
  })

  it('builds an allow tool_result for accept', () => {
    const line = adapter.formatControl({
      kind: 'approval',
      requestId: 'tool-1',
      decision: 'accept'
    })
    const parsed = JSON.parse(line!.trim())
    expect(parsed.message.content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'tool-1',
      content: 'allow'
    })
  })

  it('builds a deny tool_result for decline / cancel', () => {
    for (const decision of ['decline', 'cancel'] as const) {
      const line = adapter.formatControl({
        kind: 'approval',
        requestId: 'tool-1',
        decision
      })
      const parsed = JSON.parse(line!.trim())
      expect(parsed.message.content[0].content).toBe('deny')
    }
  })

  it('returns null for user-input-response (claude has no equivalent)', () => {
    const line = adapter.formatControl({
      kind: 'user-input-response',
      requestId: 'q-1',
      answers: {}
    })
    expect(line).toBeNull()
  })
})

describe('ClaudeAdapter — startup / drainPendingWrites', () => {
  it('writes nothing on startup (claude needs no handshake)', () => {
    expect(new ClaudeAdapter().startupBytes({ cwd: '/x' })).toBe('')
  })

  it('queues no async writes', () => {
    expect(new ClaudeAdapter().drainPendingWrites()).toBe('')
  })
})

describe('ClaudeAdapter — chunked input', () => {
  it('buffers partial lines across parseChunk calls', () => {
    const adapter = new ClaudeAdapter()
    const line = JSON.stringify({
      type: 'system', subtype: 'init',
      session_id: 's', model: 'm', cwd: '/x', tools: [], mcp_servers: []
    })
    const half = Math.floor(line.length / 2)
    const a = adapter.parseChunk(line.slice(0, half))
    expect(a).toEqual([])
    const b = adapter.parseChunk(line.slice(half) + '\n')
    expect(b.find(e => e.kind === 'session.started')).toBeDefined()
  })
})

// ── helpers ────────────────────────────────────────────────────────────

function assistant(content: object[], usage?: object): object {
  return {
    type: 'assistant',
    message: {
      id: 'msg-' + Math.random(),
      type: 'message',
      role: 'assistant',
      content,
      model: 'claude-opus-4-7',
      stop_reason: null,
      usage: usage ?? { input_tokens: 1, output_tokens: 1 }
    }
  }
}
