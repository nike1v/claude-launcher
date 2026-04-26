import { useMemo, useRef, useEffect } from 'react'
import { useMessagesStore } from '../../store/messages'
import { AssistantMessage } from './AssistantMessage'
import { UserMessage } from './UserMessage'
import { ToolUse } from './ToolUse'
import { Thinking } from './Thinking'
import { PermissionPrompt } from './PermissionPrompt'
import type { ToolResultBlock } from '../../../../shared/types'

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

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
    >
      {messages.map(({ id, event }) => {
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
          const inputBlock = content.find(
            b => b.type === 'tool_result' && b.tool_use_id === '__input__'
          )
          if (inputBlock && typeof inputBlock.content === 'string') {
            return <UserMessage key={id} text={inputBlock.content} />
          }
          // Other tool_result blocks are rendered inline with their tool_use above.
          return null
        }
        return null
      })}
      <div ref={bottomRef} />
    </div>
  )
}
