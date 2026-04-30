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
  const out: RenderedItem[] = []
  // idxById lets `replace` do O(1) updates instead of an O(n) findIndex
  // — matters when content.delta fires per-token in a streaming provider
  // (PR 4 codex emits deltas) and the item log grows long.
  const idxById = new Map<string, number>()

  const replace = (id: string, next: RenderedItem): void => {
    const idx = idxById.get(id)
    if (idx !== undefined) out[idx] = next
  }

  for (const event of events) {
    if (event.kind === 'item.started') {
      const item = makeItem(event)
      if (!item) continue
      idxById.set(item.id, out.length)
      out.push(item)
      continue
    }

    if (event.kind === 'content.delta') {
      const idx = idxById.get(event.itemId)
      if (idx === undefined) continue
      const item = out[idx]
      if (item.kind === 'assistant' && event.streamKind === 'assistant_text') {
        replace(item.id, { ...item, text: item.text + event.text })
      } else if (item.kind === 'reasoning' && event.streamKind === 'reasoning_text') {
        replace(item.id, { ...item, text: item.text + event.text })
      }
      continue
    }

    if (event.kind === 'item.completed') {
      const idx = idxById.get(event.itemId)
      if (idx === undefined) continue
      const item = out[idx]
      if (item.kind === 'tool') {
        replace(item.id, {
          ...item,
          status: event.isError ? 'failed' : 'completed',
          output: event.output
        })
      } else if (item.kind === 'permission') {
        replace(item.id, { ...item, status: 'resolved' })
      }
      continue
    }
  }

  return out
}

// Maps a typed item.started event to a RenderedItem. Returns null for
// itemTypes that don't have a dedicated render today (plan,
// command_execution, file_change, web_search, unknown) — those items
// are silently skipped from the chat view. The exhaustive switch fails
// the compile if a new ItemType is added without an explicit branch.
function makeItem(event: Extract<NormalizedEvent, { kind: 'item.started' }>): RenderedItem | null {
  switch (event.itemType) {
    case 'user_message':
      return { id: event.itemId, kind: 'user', text: event.text, attachments: event.attachments }
    case 'assistant_message':
      // text is inline when the provider sends the block whole
      // (transcript replay; claude live doesn't actually stream blocks
      // either but we keep the start/delta/complete shape for codex).
      // Subsequent content.delta events still append.
      return { id: event.itemId, kind: 'assistant', text: event.text ?? '' }
    case 'reasoning':
      return { id: event.itemId, kind: 'reasoning', text: event.text ?? '' }
    case 'tool_use':
      // Claude's permission-prompt-tool flow shows up as a tool_use whose
      // name includes "permission". Distinct render path: it's a blocking
      // gate, not a passive tool record. Detection is claude-specific —
      // when codex / cursor land we'll route their permission requests
      // via request.opened in the event taxonomy and drop this heuristic.
      if (event.name.toLowerCase().includes('permission')) {
        return {
          id: event.itemId,
          kind: 'permission',
          toolName: event.name,
          input: event.input,
          status: 'pending'
        }
      }
      return {
        id: event.itemId,
        kind: 'tool',
        name: event.name,
        input: event.input,
        status: 'running'
      }
    case 'plan':
    case 'command_execution':
    case 'file_change':
    case 'web_search':
    case 'unknown':
      return null
  }
}
