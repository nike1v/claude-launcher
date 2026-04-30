// Walk a flat NormalizedEvent stream into RenderedItem objects the
// MessageList components consume. Pure data transform — no React, easy
// to unit-test.
//
// Each `item.started` opens an item; `content.delta` appends text;
// `item.completed` finalizes (and for tool items, attaches the output).
// Session/turn events don't produce rendered items but are tracked
// elsewhere (StatusBar, listeners).

import type { NormalizedEvent, UserAttachment } from '../../../shared/events'

export type RenderedItem =
  | { id: string; kind: 'user'; text: string; attachments?: readonly UserAttachment[] }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'reasoning'; text: string }
  | {
      id: string
      kind: 'tool'
      name: string
      input: unknown
      status: 'running' | 'completed' | 'failed'
      output?: string
    }
  | {
      id: string
      kind: 'permission'
      toolName: string
      input: unknown
      status: 'pending' | 'resolved'
    }

export function deriveItems(events: readonly NormalizedEvent[]): RenderedItem[] {
  // Two parallel structures so completion / delta events can find the
  // open item without an O(n) scan of `out`.
  const out: RenderedItem[] = []
  const byId = new Map<string, RenderedItem>()

  const replace = (id: string, next: RenderedItem): void => {
    byId.set(id, next)
    const idx = out.findIndex(i => i.id === id)
    if (idx >= 0) out[idx] = next
  }

  for (const event of events) {
    if (event.kind === 'item.started') {
      let item: RenderedItem
      switch (event.itemType) {
        case 'user_message':
          item = { id: event.itemId, kind: 'user', text: event.text, attachments: event.attachments }
          break
        case 'assistant_message':
          item = { id: event.itemId, kind: 'assistant', text: '' }
          break
        case 'reasoning':
          item = { id: event.itemId, kind: 'reasoning', text: '' }
          break
        case 'tool_use':
          // claude's permission-prompt-tool flow shows up as a tool_use
          // whose name includes "permission". Distinct render path: it's
          // a blocking gate, not a passive tool record.
          if (event.name.toLowerCase().includes('permission')) {
            item = {
              id: event.itemId,
              kind: 'permission',
              toolName: event.name,
              input: event.input,
              status: 'pending'
            }
          } else {
            item = {
              id: event.itemId,
              kind: 'tool',
              name: event.name,
              input: event.input,
              status: 'running'
            }
          }
          break
        default:
          // command_execution / file_change / web_search / plan /
          // unknown: not rendered as their own card today. Future
          // codex/cursor work will give them dedicated views.
          continue
      }
      out.push(item)
      byId.set(item.id, item)
      continue
    }

    if (event.kind === 'content.delta') {
      const item = byId.get(event.itemId)
      if (!item) continue
      if (item.kind === 'assistant' && event.streamKind === 'assistant_text') {
        replace(item.id, { ...item, text: item.text + event.text })
      } else if (item.kind === 'reasoning' && event.streamKind === 'reasoning_text') {
        replace(item.id, { ...item, text: item.text + event.text })
      }
      continue
    }

    if (event.kind === 'item.completed') {
      const item = byId.get(event.itemId)
      if (!item) continue
      if (item.kind === 'tool') {
        replace(item.id, {
          ...item,
          status: event.isError ? 'failed' : 'completed',
          output: event.output
        })
      } else if (item.kind === 'permission') {
        replace(item.id, { ...item, status: 'resolved' })
      }
      // user / assistant / reasoning items don't track a completion
      // state today — they render the same once their text has streamed
      // in. (Claude sends them all-at-once anyway.)
      continue
    }
  }

  return out
}
