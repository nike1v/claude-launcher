import { useMemo, useRef, useEffect, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { useMessagesStore } from '../../store/messages'
import { useSessionsStore } from '../../store/sessions'
import { AssistantMessage } from './AssistantMessage'
import { UserMessage } from './UserMessage'
import { ToolUse } from './ToolUse'
import { Thinking } from './Thinking'
import { ToolGroup } from './ToolGroup'
import { PermissionPrompt } from './PermissionPrompt'
import type { DocumentBlock, ImageBlock, ToolResultBlock } from '../../../../shared/types'
import type { ChatMessage } from '../../store/messages'
import { groupMessages, type RenderGroup } from '../../lib/group-messages'

interface Props {
  sessionId: string
}

export function MessageList({ sessionId }: Props): JSX.Element {
  const { messagesBySession } = useMessagesStore()
  const messages = messagesBySession[sessionId] ?? []
  const status = useSessionsStore(s => s.sessions[sessionId]?.status)
  const isBusy = status === 'busy'
  const bottomRef = useRef<HTMLDivElement>(null)
  const shouldFollowRef = useRef(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Watch the actual content size — not just messages.length — so the view
  // stays pinned to the bottom while async work (markdown, images, restored
  // history, tab activation) keeps growing the scroll height after the last
  // state change. The ResizeObserver fires on the initial mount too, which
  // covers "open the chat and land on the latest message".
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(() => {
      if (shouldFollowRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: 'auto' })
      }
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

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
      className="flex-1 overflow-y-auto px-4 py-4"
    >
      <div ref={contentRef} className="space-y-3">
        {groups.map((group, i) => {
          if (group.kind === 'message') return renderMessage(group.message)
          return (
            <ToolGroup key={`g-${i}`} toolNames={group.toolNames}>
              {group.messages.map(renderMessage)}
            </ToolGroup>
          )
        })}
        {isBusy && (
          <div className="flex items-center gap-2 text-xs text-white/40">
            <Loader2 size={12} className="animate-spin" />
            <span className="italic">claude is thinking…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

