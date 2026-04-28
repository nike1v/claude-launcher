import type { StreamJsonEvent } from '../../../shared/types'
import type { ChatMessage } from '../store/messages'

// Pure data transform that turns a stream of ChatMessages into the rows
// MessageList renders. Lives here (not inside MessageList) so it can be
// unit-tested without React, and so MessageList stays focused on layout.

export type RenderGroup =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'tools'; messages: ChatMessage[]; toolNames: string[] }

export function groupMessages(messages: ChatMessage[]): RenderGroup[] {
  const groups: RenderGroup[] = []
  let buffer: ChatMessage[] = []
  let bufferTools: string[] = []

  const flush = (): void => {
    if (buffer.length === 0) return
    if (bufferTools.length > 0) {
      groups.push({ kind: 'tools', messages: buffer, toolNames: bufferTools })
    }
    // If the buffer had only invisible tool_result echoes (no actual tool_use
    // names), drop it — there's nothing to show.
    buffer = []
    bufferTools = []
  }

  for (const msg of messages) {
    const cls = classify(msg.event)
    if (cls.kind === 'tool') {
      buffer.push(msg)
      bufferTools.push(...cls.toolNames)
    } else if (cls.kind === 'content') {
      flush()
      groups.push({ kind: 'message', message: msg })
    }
    // 'skip' messages contribute nothing and don't break a tool run.
  }
  flush()
  return groups
}

function classify(event: StreamJsonEvent):
  | { kind: 'content' }
  | { kind: 'tool'; toolNames: string[] }
  | { kind: 'skip' } {
  if (event.type === 'assistant') {
    const blocks = event.message.content
    if (!blocks.length) return { kind: 'skip' }
    const hasText = blocks.some(b => b.type === 'text' && b.text.trim().length > 0)
    if (hasText) return { kind: 'content' }
    const toolNames = blocks
      .filter((b): b is { type: 'tool_use'; id: string; name: string; input: unknown } =>
        b.type === 'tool_use'
      )
      .map(b => b.name)
    if (toolNames.length === 0) {
      // pure thinking with no tool calls — hide it inside a tool group so the
      // empty space disappears. (Thinking still renders inside the group.)
      return { kind: 'tool', toolNames: [] }
    }
    return { kind: 'tool', toolNames }
  }
  if (event.type === 'user') {
    const c = event.message.content
    if (typeof c === 'string') return c.trim() ? { kind: 'content' } : { kind: 'skip' }
    const hasInputMarker = c.some(b => b.type === 'tool_result' && b.tool_use_id === '__input__')
    const hasUserText = c.some(b => b.type === 'text')
    const hasAttachment = c.some(b => b.type === 'image' || b.type === 'document')
    if (hasInputMarker || hasUserText || hasAttachment) return { kind: 'content' }
    // Otherwise it's a tool_result echo for a previous tool_use — invisible
    // on its own, but should sit inside the surrounding tool group rather
    // than break the run.
    return { kind: 'tool', toolNames: [] }
  }
  return { kind: 'skip' }
}
