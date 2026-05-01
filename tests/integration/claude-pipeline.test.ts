import { describe, it, expect } from 'vitest'
import { ClaudeAdapter } from '../../src/main/providers/claude/adapter'
import { deriveItems, type RenderedItem } from '../../src/renderer/src/lib/derive-items'
import { groupMessages } from '../../src/renderer/src/lib/group-messages'
import type { NormalizedEvent } from '../../src/shared/events'

// End-to-end pipeline check: stream-json line on the wire → adapter
// → NormalizedEvent[] → deriveItems (renderer) → groupMessages →
// RenderedItem rows the chat actually paints. Catches regressions
// across the abstraction boundary that unit tests on either half
// would miss in isolation.

function feed(adapter: ClaudeAdapter, ...events: object[]): NormalizedEvent[] {
  return events.flatMap(e => adapter.parseChunk(JSON.stringify(e) + '\n'))
}

function initEvent(sessionId: string, model: string, cwd: string): object {
  return { type: 'system', subtype: 'init', session_id: sessionId, model, cwd, tools: [], mcp_servers: [] }
}

function assistantEvent(content: object[]): object {
  return {
    type: 'assistant',
    message: {
      id: 'msg-' + Math.random(),
      type: 'message',
      role: 'assistant',
      content,
      model: 'claude-opus-4-7',
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 3 }
    }
  }
}

function userEvent(content: string | object[]): object {
  return { type: 'user', message: { role: 'user', content } }
}

function resultEvent(opts: { contextWindow?: number; isError?: boolean } = {}): object {
  return {
    type: 'result',
    subtype: opts.isError ? 'error_during_execution' : 'success',
    session_id: 'sess-1',
    is_error: opts.isError ?? false,
    num_turns: 1,
    modelUsage: opts.contextWindow ? { 'claude-opus-4-7': { contextWindow: opts.contextWindow } } : undefined
  }
}

// Strip the unstable item ids before comparing items across paths.
function stripIds(items: RenderedItem[]): unknown[] {
  return items.map(item => {
    // Drop the random itemId and the wall-clock timestamp — both are
    // expected to differ between live (Date.now()) and replay (parsed
    // from the line, which lacks a JSONL `timestamp` field in this
    // synthetic test fixture) and the equivalence we care about is
    // structural (same items in the same order with the same content),
    // not byte-identical.
    const { id: _id, ...rest } = item as RenderedItem & { timestamp?: number }
    delete (rest as { timestamp?: number }).timestamp
    return rest
  })
}

describe('claude pipeline — text-only assistant turn', () => {
  it('renders a single assistant bubble with the response text', () => {
    const adapter = new ClaudeAdapter()
    const events = [
      ...feed(adapter, initEvent('sess-1', 'claude-opus-4-7', '/srv')),
      ...feed(adapter, assistantEvent([{ type: 'text', text: 'Hello world' }])),
      ...feed(adapter, resultEvent({ contextWindow: 200_000 }))
    ]
    const groups = groupMessages(deriveItems(events))
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      kind: 'message',
      item: { kind: 'assistant', text: 'Hello world' }
    })
  })
})

describe('claude pipeline — tool call with result', () => {
  it('pairs the tool_use with its tool_result and reports completed status', () => {
    const adapter = new ClaudeAdapter()
    const events = [
      ...feed(adapter, initEvent('sess-1', 'claude-opus-4-7', '/srv')),
      ...feed(adapter, assistantEvent([
        { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } }
      ])),
      ...feed(adapter, userEvent([
        { type: 'tool_result', tool_use_id: 'tool-1', content: 'file1\nfile2' }
      ])),
      ...feed(adapter, resultEvent({ contextWindow: 200_000 }))
    ]
    const items = deriveItems(events)
    const tool = items.find(i => i.kind === 'tool')
    expect(tool).toMatchObject({
      kind: 'tool',
      name: 'Bash',
      status: 'completed',
      output: 'file1\nfile2'
    })
  })

  it('flags an erroring tool_result as failed', () => {
    const adapter = new ClaudeAdapter()
    const events = [
      ...feed(adapter, assistantEvent([
        { type: 'tool_use', id: 'tool-2', name: 'Read', input: { path: '/nope' } }
      ])),
      ...feed(adapter, userEvent([
        { type: 'tool_result', tool_use_id: 'tool-2', content: 'ENOENT', is_error: true }
      ]))
    ]
    const tool = deriveItems(events).find(i => i.kind === 'tool')
    expect(tool).toMatchObject({ status: 'failed' })
  })

  it('renders multiple consecutive tools in one ToolGroup', () => {
    const adapter = new ClaudeAdapter()
    const events = [
      ...feed(adapter, assistantEvent([
        { type: 'tool_use', id: 't-1', name: 'Bash', input: { command: 'ls' } }
      ])),
      ...feed(adapter, assistantEvent([
        { type: 'tool_use', id: 't-2', name: 'Read', input: { path: '/x' } }
      ]))
    ]
    const groups = groupMessages(deriveItems(events))
    const toolGroups = groups.filter(g => g.kind === 'tools')
    expect(toolGroups).toHaveLength(1)
    expect(toolGroups[0].kind === 'tools' && toolGroups[0].toolNames).toEqual(['Bash', 'Read'])
  })
})

describe('claude pipeline — permission prompts', () => {
  it('routes a tool_use with "permission" in its name through the permission render path', () => {
    const adapter = new ClaudeAdapter()
    const events = feed(adapter, assistantEvent([
      { type: 'tool_use', id: 'p-1', name: 'permission_request_tool', input: { tool: 'Bash', cmd: 'rm -rf' } }
    ]))
    const item = deriveItems(events)[0]
    expect(item).toMatchObject({
      kind: 'permission',
      toolName: 'permission_request_tool',
      status: 'pending'
    })
  })

  it('marks the permission as resolved once the matching tool_result arrives', () => {
    const adapter = new ClaudeAdapter()
    const events = [
      ...feed(adapter, assistantEvent([
        { type: 'tool_use', id: 'p-1', name: 'permission_request_tool', input: {} }
      ])),
      ...feed(adapter, userEvent([
        { type: 'tool_result', tool_use_id: 'p-1', content: 'allow' }
      ]))
    ]
    const item = deriveItems(events)[0]
    expect(item).toMatchObject({ kind: 'permission', status: 'resolved' })
  })
})

describe('claude pipeline — multi-block assistant turn', () => {
  it('produces three items in order: reasoning, assistant, tool_use', () => {
    const adapter = new ClaudeAdapter()
    const events = feed(adapter, assistantEvent([
      { type: 'thinking', thinking: 'pondering...' },
      { type: 'text', text: 'Let me check.' },
      { type: 'tool_use', id: 't-1', name: 'Read', input: { path: '/foo' } }
    ]))
    const items = deriveItems(events)
    expect(items.map(i => i.kind)).toEqual(['reasoning', 'assistant', 'tool'])
  })

  it('groups reasoning + tool with the surrounding assistant text correctly', () => {
    const adapter = new ClaudeAdapter()
    const events = feed(adapter, assistantEvent([
      { type: 'thinking', thinking: 'pondering' },
      { type: 'text', text: 'Got it.' },
      { type: 'tool_use', id: 't-1', name: 'Read', input: {} }
    ]))
    const groups = groupMessages(deriveItems(events))
    // reasoning is a tool-row item; assistant is a message; tool_use is a tool-row item.
    // Result: [tools (reasoning), message (assistant), tools (tool_use)].
    expect(groups.map(g => g.kind)).toEqual(['tools', 'message', 'tools'])
  })
})

describe('claude pipeline — user attachments', () => {
  it('translates an image attachment block into UserAttachment payload on the user item', () => {
    const adapter = new ClaudeAdapter()
    const events = adapter.parseTranscript(JSON.stringify(userEvent([
      { type: 'text', text: 'see this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA=' } }
    ])))
    const items = deriveItems(events)
    expect(items[0]).toMatchObject({
      kind: 'user',
      text: 'see this',
      attachments: [{ kind: 'image', mediaType: 'image/png', data: 'AAA=' }]
    })
  })
})

describe('claude pipeline — live vs replay equivalence', () => {
  it('parseChunk and parseTranscript produce the same renderable items for a full turn', () => {
    // The user sees the same chat whether they're watching it live
    // (parseChunk on a stream of stdin chunks) or restoring it from
    // disk (parseTranscript on the JSONL transcript). Without this
    // test, divergence between the two code paths can ship silently —
    // the only way to notice is "tab restore renders differently from
    // the live session that wrote it".
    const turn = [
      // No init in replay — it's not in the on-disk transcript. Live
      // gets it from the actual claude binary on session start.
      assistantEvent([
        { type: 'text', text: 'Looking it up.' },
        { type: 'tool_use', id: 't-1', name: 'Bash', input: { command: 'pwd' } }
      ]),
      userEvent([
        { type: 'tool_result', tool_use_id: 't-1', content: '/srv/app' }
      ]),
      assistantEvent([
        { type: 'text', text: "We're in /srv/app." }
      ]),
      resultEvent({ contextWindow: 200_000 })
    ]

    // Live: chunk-by-chunk through parseChunk
    const liveAdapter = new ClaudeAdapter()
    const liveEvents = turn.flatMap(e => feed(liveAdapter, e))
    const liveItems = stripIds(deriveItems(liveEvents))

    // Replay: whole transcript at once through parseTranscript
    const replayAdapter = new ClaudeAdapter()
    const transcript = turn.map(e => JSON.stringify(e)).join('\n')
    const replayEvents = replayAdapter.parseTranscript(transcript)
    const replayItems = stripIds(deriveItems(replayEvents))

    expect(liveItems).toEqual(replayItems)
  })
})

describe('claude pipeline — chunked stdin', () => {
  it('reassembles a stream-json line split across two parseChunk calls', () => {
    const adapter = new ClaudeAdapter()
    const line = JSON.stringify(assistantEvent([{ type: 'text', text: 'split me' }]))
    const half = Math.floor(line.length / 2)

    const first = adapter.parseChunk(line.slice(0, half))
    const second = adapter.parseChunk(line.slice(half) + '\n')

    expect(first).toEqual([])
    const items = deriveItems([...first, ...second])
    expect(items[0]).toMatchObject({ kind: 'assistant', text: 'split me' })
  })
})

describe('claude pipeline — interrupt mid-turn', () => {
  it('keeps existing items rendered when the turn stops without a result event', () => {
    // Mimics the Stop-button flow: claude has emitted a partial
    // assistant block but no result event arrived (process killed,
    // interrupt acknowledged, etc.). The renderer should still show
    // the partial response intact rather than erase it.
    const adapter = new ClaudeAdapter()
    const events = [
      ...feed(adapter, initEvent('sess-1', 'claude-opus-4-7', '/srv')),
      ...feed(adapter, assistantEvent([
        { type: 'text', text: 'I started writing then stopped' }
      ]))
      // No result event.
    ]
    const items = deriveItems(events)
    expect(items[0]).toMatchObject({ kind: 'assistant', text: 'I started writing then stopped' })
  })
})
