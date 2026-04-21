import { useRef, useEffect } from 'react'
import { useMessagesStore } from '../../store/messages'
import { AssistantMessage } from './AssistantMessage'
import { UserMessage } from './UserMessage'
import { ToolUse } from './ToolUse'
import { PermissionPrompt } from './PermissionPrompt'

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

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
    >
      {messages.map(({ id, event }) => {
        if (event.type === 'assistant') {
          const toolUses = event.message.content.filter(b => b.type === 'tool_use')
          const textBlocks = event.message.content.filter(b => b.type === 'text')

          return (
            <div key={id} className="space-y-2">
              {textBlocks.map((block, i) =>
                block.type === 'text' ? (
                  <AssistantMessage key={i} text={block.text} />
                ) : null
              )}
              {toolUses.map((block, i) =>
                block.type === 'tool_use'
                  ? block.name.toLowerCase().includes('permission')
                    ? <PermissionPrompt key={i} sessionId={sessionId} toolUseId={block.id} toolName={block.name} input={block.input} />
                    : <ToolUse key={i} id={block.id} name={block.name} input={block.input} sessionId={sessionId} />
                  : null
              )}
            </div>
          )
        }
        if (event.type === 'user') {
          const textContent = event.message.content
            .filter(b => b.type === 'tool_result' && b.tool_use_id === '__input__')
            .map(b => (b as any).content as string)
            .join('')
          if (textContent) return <UserMessage key={id} text={textContent} />
          return null
        }
        return null
      })}
      <div ref={bottomRef} />
    </div>
  )
}
