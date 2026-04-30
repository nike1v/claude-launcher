import { describe, it, expect } from 'vitest'
import { deriveItems } from '../../src/renderer/src/lib/derive-items'
import { groupMessages } from '../../src/renderer/src/lib/group-messages'
import type { NormalizedEvent } from '../../src/shared/events'

const userItem = (id: string, text: string): NormalizedEvent[] => [
  { kind: 'item.started', itemId: id, turnId: 't', itemType: 'user_message', text },
  { kind: 'item.completed', itemId: id, status: 'completed' }
]

const assistantText = (id: string, text: string): NormalizedEvent[] => [
  { kind: 'item.started', itemId: id, turnId: 't', itemType: 'assistant_message' },
  { kind: 'content.delta', itemId: id, streamKind: 'assistant_text', text },
  { kind: 'item.completed', itemId: id, status: 'completed' }
]

const reasoning = (id: string, text: string): NormalizedEvent[] => [
  { kind: 'item.started', itemId: id, turnId: 't', itemType: 'reasoning' },
  { kind: 'content.delta', itemId: id, streamKind: 'reasoning_text', text },
  { kind: 'item.completed', itemId: id, status: 'completed' }
]

const toolCall = (id: string, name: string, input: unknown, output?: string, isError?: boolean): NormalizedEvent[] => [
  { kind: 'item.started', itemId: id, turnId: 't', itemType: 'tool_use', name, input },
  ...(output !== undefined
    ? [{ kind: 'item.completed' as const, itemId: id, status: isError ? 'failed' as const : 'completed' as const, output, isError }]
    : [])
]

describe('deriveItems', () => {
  it('builds an assistant item by accumulating content.delta text', () => {
    const items = deriveItems([
      { kind: 'item.started', itemId: 'a', turnId: 't', itemType: 'assistant_message' },
      { kind: 'content.delta', itemId: 'a', streamKind: 'assistant_text', text: 'Hello, ' },
      { kind: 'content.delta', itemId: 'a', streamKind: 'assistant_text', text: 'world.' },
      { kind: 'item.completed', itemId: 'a', status: 'completed' }
    ])
    expect(items).toEqual([{ id: 'a', kind: 'assistant', text: 'Hello, world.' }])
  })

  it('renders an in-flight tool as status: running and applies output on completion', () => {
    const before = deriveItems(toolCall('t1', 'Bash', { command: 'ls' }))
    expect(before[0]).toMatchObject({ kind: 'tool', status: 'running' })

    const after = deriveItems(toolCall('t1', 'Bash', { command: 'ls' }, 'a b c'))
    expect(after[0]).toMatchObject({ kind: 'tool', status: 'completed', output: 'a b c' })
  })

  it('marks an errored tool with status: failed', () => {
    const items = deriveItems(toolCall('t1', 'Bash', {}, 'oops', true))
    expect(items[0]).toMatchObject({ kind: 'tool', status: 'failed' })
  })

  it('routes a tool whose name contains "permission" through the permission render path', () => {
    const items = deriveItems([
      { kind: 'item.started', itemId: 'p1', turnId: 't', itemType: 'tool_use', name: 'permission_request_tool', input: {} }
    ])
    expect(items[0]).toMatchObject({ kind: 'permission', toolName: 'permission_request_tool', status: 'pending' })
  })

  it('builds a user_message item from item.started payload', () => {
    const items = deriveItems(userItem('u1', 'hello'))
    expect(items).toEqual([{ id: 'u1', kind: 'user', text: 'hello', attachments: undefined }])
  })

  it('ignores deltas referencing an unknown item', () => {
    const items = deriveItems([
      { kind: 'content.delta', itemId: 'ghost', streamKind: 'assistant_text', text: 'x' }
    ])
    expect(items).toEqual([])
  })
})

describe('groupMessages', () => {
  it('keeps user / assistant items as standalone message rows', () => {
    const items = deriveItems([
      ...userItem('u1', 'hi'),
      ...assistantText('a1', 'reply')
    ])
    const groups = groupMessages(items)
    expect(groups.map(g => g.kind)).toEqual(['message', 'message'])
  })

  it('collapses consecutive tool + reasoning items into one tools group', () => {
    const items = deriveItems([
      ...userItem('u1', 'hi'),
      ...reasoning('r1', 'thinking'),
      ...toolCall('t1', 'Bash', {}, 'ok'),
      ...toolCall('t2', 'Read', {}, 'data'),
      ...assistantText('a1', 'done')
    ])
    const groups = groupMessages(items)
    expect(groups.map(g => g.kind)).toEqual(['message', 'tools', 'message'])
    const toolsGroup = groups.find(g => g.kind === 'tools')
    expect(toolsGroup?.kind === 'tools' && toolsGroup.toolNames).toEqual(['Bash', 'Read'])
  })

  it('breaks the tools group when a permission item arrives between tools', () => {
    const items = deriveItems([
      ...toolCall('t1', 'Bash', {}, 'ok'),
      { kind: 'item.started', itemId: 'p1', turnId: 't', itemType: 'tool_use', name: 'permission_request_tool', input: {} },
      ...toolCall('t2', 'Read', {}, 'data')
    ])
    const groups = groupMessages(items)
    expect(groups.map(g => g.kind)).toEqual(['tools', 'message', 'tools'])
  })
})
