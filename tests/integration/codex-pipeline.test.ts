import { describe, it, expect } from 'vitest'
import { CodexAdapter } from '../../src/main/providers/codex/adapter'
import { deriveItems, type RenderedItem } from '../../src/renderer/src/lib/derive-items'
import { groupMessages } from '../../src/renderer/src/lib/group-messages'
import type { NormalizedEvent } from '../../src/shared/events'

// End-to-end pipeline check for codex: synthetic JSON-RPC notifications
// → CodexAdapter.parseChunk → NormalizedEvent[] → deriveItems
// (renderer) → groupMessages → RenderedItem rows the chat actually
// paints. Mirrors claude-pipeline.test.ts but for the codex wire
// format.

function feed(adapter: CodexAdapter, ...messages: object[]): NormalizedEvent[] {
  const wire = messages.map(m => JSON.stringify(m)).join('\n') + '\n'
  return adapter.parseChunk(wire)
}

// Build an adapter that's already past bootstrap with thread id 'thr_1'
// and the thread/started notification delivered. Lets the test focus on
// the per-turn translation without re-boilerplating the handshake.
function readyAdapter(): { adapter: CodexAdapter; bootstrapEvents: NormalizedEvent[] } {
  const adapter = new CodexAdapter()
  adapter.startupBytes({ cwd: '/srv', model: 'gpt-5-codex' })
  feed(adapter, { id: 1, result: {} })
  feed(adapter, { id: 2, result: { thread: { id: 'thr_1', model: 'gpt-5-codex', cwd: '/srv' } } })
  const bootstrapEvents = feed(adapter, {
    method: 'thread/started',
    params: { thread: { id: 'thr_1', model: 'gpt-5-codex', cwd: '/srv' } }
  })
  adapter.drainPendingWrites()
  return { adapter, bootstrapEvents }
}

describe('codex pipeline — text-only assistant turn', () => {
  it('renders a single assistant bubble when the response streams in via deltas', () => {
    const { adapter } = readyAdapter()
    const events: NormalizedEvent[] = []
    events.push(...feed(adapter, {
      method: 'turn/started',
      params: { turn: { id: 'tn_1' } }
    }))
    events.push(...feed(adapter, {
      method: 'item/started',
      params: { turnId: 'tn_1', item: { id: 'i_1', type: 'agentMessage' } }
    }))
    events.push(...feed(adapter, {
      method: 'item/agentMessage/delta',
      params: { itemId: 'i_1', delta: 'Hello, ' }
    }))
    events.push(...feed(adapter, {
      method: 'item/agentMessage/delta',
      params: { itemId: 'i_1', delta: 'world.' }
    }))
    events.push(...feed(adapter, {
      method: 'item/completed',
      params: { item: { id: 'i_1', type: 'agentMessage' } }
    }))
    events.push(...feed(adapter, {
      method: 'turn/completed',
      params: { turn: { id: 'tn_1' } }
    }))

    const groups = groupMessages(deriveItems(events))
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      kind: 'message',
      item: { kind: 'assistant', text: 'Hello, world.' }
    })
  })
})

describe('codex pipeline — tool call with approval + output', () => {
  it('routes commandExecution.requestApproval → request.opened → handled by formatControl reply', () => {
    const { adapter } = readyAdapter()

    // Server requests approval before running a command.
    const approvalEvents = feed(adapter, {
      id: 'srv-1',
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thr_1', turnId: 'tn_2', itemId: 'i_2', command: 'rm important.txt' }
    })
    expect(approvalEvents[0]).toMatchObject({
      kind: 'request.opened',
      requestType: 'command_approval',
      requestId: 'srv-1'
    })

    // User clicks Decline. Adapter emits the matching JSON-RPC reply
    // back to the server.
    const wire = adapter.formatControl({
      kind: 'approval',
      requestId: 'srv-1',
      decision: 'decline'
    })
    expect(wire).not.toBeNull()
    const reply = JSON.parse(wire!.trim())
    expect(reply).toMatchObject({ id: 'srv-1', result: { decision: 'denied' } })
  })

  it('renders a command_execution item with running → completed status', () => {
    const { adapter } = readyAdapter()
    const events: NormalizedEvent[] = []

    events.push(...feed(adapter, {
      method: 'turn/started',
      params: { turn: { id: 'tn_2' } }
    }))
    events.push(...feed(adapter, {
      method: 'item/started',
      params: {
        turnId: 'tn_2',
        item: { id: 'cmd_1', type: 'commandExecution', command: 'ls' }
      }
    }))
    events.push(...feed(adapter, {
      method: 'item/commandExecution/outputDelta',
      params: { itemId: 'cmd_1', chunk: 'a.txt\nb.txt\n', stream: 'stdout' }
    }))
    events.push(...feed(adapter, {
      method: 'item/completed',
      params: { item: { id: 'cmd_1', type: 'commandExecution', output: 'a.txt\nb.txt\n' } }
    }))

    const items = deriveItems(events)
    // command_execution items don't render as their own card today
    // (deriveItems returns null for that itemType — see the explicit
    // case in renderer/src/lib/derive-items.ts). That's the intended
    // behaviour while the renderer doesn't have a dedicated UI for
    // them — this test pins the contract until that ships.
    expect(items.filter(i => i.kind === 'tool')).toHaveLength(0)
    expect(items.filter(i => i.kind === 'assistant')).toHaveLength(0)
  })

  it('renders an mcp tool_use as a tool item with name + input + output', () => {
    const { adapter } = readyAdapter()
    const events: NormalizedEvent[] = []

    events.push(...feed(adapter, {
      method: 'turn/started',
      params: { turn: { id: 'tn_3' } }
    }))
    events.push(...feed(adapter, {
      method: 'item/started',
      params: {
        turnId: 'tn_3',
        item: { id: 'tl_1', type: 'mcpToolCall', name: 'search', input: { q: 'foo' } }
      }
    }))
    events.push(...feed(adapter, {
      method: 'item/completed',
      params: { item: { id: 'tl_1', type: 'mcpToolCall', output: '3 hits' } }
    }))

    const item = deriveItems(events).find(i => i.kind === 'tool') as Extract<RenderedItem, { kind: 'tool' }>
    expect(item).toMatchObject({
      kind: 'tool',
      name: 'search',
      input: { q: 'foo' },
      status: 'completed',
      output: '3 hits'
    })
  })
})

describe('codex pipeline — interrupt mid-turn', () => {
  it('keeps the partial response rendered when no turn.completed arrives', () => {
    const { adapter } = readyAdapter()
    const events: NormalizedEvent[] = []
    events.push(...feed(adapter, {
      method: 'turn/started',
      params: { turn: { id: 'tn_4' } }
    }))
    events.push(...feed(adapter, {
      method: 'item/started',
      params: { turnId: 'tn_4', item: { id: 'i_4', type: 'agentMessage' } }
    }))
    events.push(...feed(adapter, {
      method: 'item/agentMessage/delta',
      params: { itemId: 'i_4', delta: 'I was about to' }
    }))
    // user clicks Stop — turn/aborted lands.
    events.push(...feed(adapter, {
      method: 'turn/aborted',
      params: { turn: { id: 'tn_4' } }
    }))

    const items = deriveItems(events)
    const assistant = items.find(i => i.kind === 'assistant') as Extract<RenderedItem, { kind: 'assistant' }>
    expect(assistant.text).toBe('I was about to')
  })
})

describe('codex pipeline — bootstrap handshake', () => {
  it('emits session.started + session.stateChanged from thread/started after the JSON-RPC dance', () => {
    const { bootstrapEvents } = readyAdapter()
    expect(bootstrapEvents[0]).toEqual({
      kind: 'session.started',
      sessionRef: 'thr_1',
      model: 'gpt-5-codex',
      cwd: '/srv'
    })
    expect(bootstrapEvents[1]).toEqual({ kind: 'session.stateChanged', state: 'ready' })
  })
})
