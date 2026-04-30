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
