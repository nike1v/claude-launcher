import { useMemo, useRef, useEffect, type ReactNode } from 'react'
import { useMessagesStore } from '../../store/messages'
import { AssistantMessage } from './AssistantMessage'
import { UserMessage } from './UserMessage'
import { ToolUse } from './ToolUse'
import { Thinking } from './Thinking'
import { ToolGroup } from './ToolGroup'
import { PermissionPrompt } from './PermissionPrompt'
import type { DocumentBlock, ImageBlock, StreamJsonEvent, ToolResultBlock } from '../../../../shared/types'
import type { ChatMessage } from '../../store/messages'

interface Props {
  sessionId: string
}

export function MessageList({ sessionId }: Props): JSX.Element {
  const { messagesBySession } = useMessagesStore()
  const messages = messagesBySession[sessionId] ?? []
  const bottomRef = useRef<HTMLDivElement>(null)
  const shouldFollowRef = useRef(true)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (shouldFollowRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    shouldFollowRef.current = distanceFromBottom < 100
  }

  // Pair tool_use blocks with their tool_result blocks (which arrive in
  // subsequent user events) so each tool call renders its own output inline.
  const toolResultsById = useMemo(() => {
    const map = new Map<string, ToolResultBlock>()
    for (const { event } of messages) {
      if (event.type !== 'user') continue
      const content = event.message.content
      if (typeof content === 'string') continue
      for (const block of content) {
        if (block.type === 'tool_result' && block.tool_use_id !== '__input__') {
          map.set(block.tool_use_id, block)
        }
      }
    }
    return map
  }, [messages])

  // Collapse runs of tool-only messages (assistant messages whose only blocks
  // are tool_use/thinking, plus user messages that are pure tool_result echoes)
  // into a single ToolGroup so the gap between user prompts and assistant
  // replies isn't a wall of tool chips.
  const groups = useMemo(() => groupMessages(messages), [messages])

  const renderMessage = (msg: ChatMessage): ReactNode => {
    const { id, event } = msg
    if (event.type === 'assistant') {
      const blocks = event.message.content
      if (!blocks.length) return null

      return (
        <div key={id} className="space-y-2">
          {blocks.map((block, i) => {
            if (block.type === 'text') {
              return block.text.trim() ? <AssistantMessage key={i} text={block.text} /> : null
            }
            if (block.type === 'thinking') {
              return <Thinking key={i} text={block.thinking} />
            }
            if (block.type === 'tool_use') {
              if (block.name.toLowerCase().includes('permission')) {
                return (
                  <PermissionPrompt
                    key={i}
                    sessionId={sessionId}
                    toolUseId={block.id}
                    toolName={block.name}
                    input={block.input}
                  />
                )
              }
              return (
                <ToolUse
                  key={i}
                  id={block.id}
                  name={block.name}
                  input={block.input}
                  sessionId={sessionId}
                  result={toolResultsById.get(block.id)}
                />
              )
            }
            return null
          })}
        </div>
      )
    }
    if (event.type === 'user') {
      const content = event.message.content
      if (typeof content === 'string') {
        return content.trim() ? <UserMessage key={id} text={content} /> : null
      }

      const attachments: Array<ImageBlock | DocumentBlock> = []
      const textParts: string[] = []
      for (const block of content) {
        if (block.type === 'image' || block.type === 'document') {
          attachments.push(block)
        } else if (block.type === 'text') {
          textParts.push(block.text)
        } else if (block.type === 'tool_result' && block.tool_use_id === '__input__') {
          if (typeof block.content === 'string') textParts.push(block.content)
        }
      }
      const text = textParts.join('\n').trim()
      if (!text && attachments.length === 0) return null
      return <UserMessage key={id} text={text} attachments={attachments} />
    }
    return null
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
    >
      {groups.map((group, i) => {
        if (group.kind === 'message') return renderMessage(group.message)
        return (
          <ToolGroup key={`g-${i}`} toolNames={group.toolNames}>
            {group.messages.map(renderMessage)}
          </ToolGroup>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}

type RenderGroup =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'tools'; messages: ChatMessage[]; toolNames: string[] }

function groupMessages(messages: ChatMessage[]): RenderGroup[] {
  const groups: RenderGroup[] = []
  let buffer: ChatMessage[] = []
  let bufferTools: string[] = []

  const flush = () => {
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
