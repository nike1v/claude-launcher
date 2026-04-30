import type { RenderedItem } from './derive-items'

// Pure data transform that turns a stream of RenderedItem into the
// rows MessageList renders. Lives here (not inside MessageList) so it
// can be unit-tested without React, and so MessageList stays focused
// on layout.
//
// Tools and reasoning are collapsed into a single "tools" group so the
// gap between the user prompt and the assistant's reply isn't a wall
// of tool chips. User and assistant messages each become their own
// "message" group.

export type RenderGroup =
  | { kind: 'message'; item: RenderedItem }
  | { kind: 'tools'; items: RenderedItem[]; toolNames: string[] }

export function groupMessages(items: readonly RenderedItem[]): RenderGroup[] {
  const groups: RenderGroup[] = []
  let buffer: RenderedItem[] = []
  let bufferTools: string[] = []

  const flush = (): void => {
    if (buffer.length === 0) return
    groups.push({ kind: 'tools', items: buffer, toolNames: bufferTools })
    buffer = []
    bufferTools = []
  }

  for (const item of items) {
    if (item.kind === 'tool' || item.kind === 'reasoning') {
      buffer.push(item)
      if (item.kind === 'tool') bufferTools.push(item.name)
    } else {
      // user / assistant / permission — these break the tool run.
      flush()
      groups.push({ kind: 'message', item })
    }
  }
  flush()
  return groups
}
