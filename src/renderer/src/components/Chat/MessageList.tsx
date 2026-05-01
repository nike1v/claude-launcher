import { memo, useMemo, useRef, useEffect, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { useMessagesStore } from '../../store/messages'
import { useSessionsStore } from '../../store/sessions'
import { AssistantMessage } from './AssistantMessage'
import { UserMessage } from './UserMessage'
import { ToolUse } from './ToolUse'
import { Thinking } from './Thinking'
import { ToolGroup } from './ToolGroup'
import { PermissionPrompt } from './PermissionPrompt'
import { deriveItems, type RenderedItem } from '../../lib/derive-items'
import { groupMessages } from '../../lib/group-messages'

interface Props {
  sessionId: string
}

const EMPTY: readonly never[] = []

// memo'd: when activeSessionId changes, App re-renders and would
// otherwise cascade through ChatPanel into MessageList for every tab —
// each running deriveItems + groupMessages over its full event log
// even though nothing about the inactive tabs' content changed. The
// `sessionId` prop is stable per tab so memo skips those re-renders.
// MessageList still re-runs when its own selectors fire (events on
// this session, status flips).
export const MessageList = memo(function MessageList({ sessionId }: Props) {
  // Per-session selector — without this, MessageList re-renders on
  // every event in *any* session because the default object identity
  // changes each store update. The stable EMPTY fallback keeps
  // useMemo's deps reference-equal between renders for empty sessions.
  const events = useMessagesStore(s => s.eventsBySession[sessionId] ?? EMPTY)
  const status = useSessionsStore(s => s.sessions[sessionId]?.status)
  const isBusy = status === 'busy'
  const bottomRef = useRef<HTMLDivElement>(null)
  const shouldFollowRef = useRef(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Stale-busy detection. Sessions sometimes get wedged (auto-compact
  // mid-stream, hung tool call, ignored interrupt) and the spinner
  // keeps spinning forever with no way to tell. Tracking the
  // wall-clock time of the last event arrival on this session, ticking
  // every 5 s while busy, lets the UI surface a hint that the session
  // looks unresponsive — at which point closing the tab is the user's
  // recovery path.
  const lastEventAtRef = useRef(Date.now())
  useEffect(() => {
    lastEventAtRef.current = Date.now()
  }, [events.length])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isBusy) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [isBusy])
  const STALE_THRESHOLD_MS = 30_000
  const looksStale = isBusy && now - lastEventAtRef.current > STALE_THRESHOLD_MS

  // Watch the actual content size — not just events.length — so the view
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

  const items = useMemo(() => deriveItems(events), [events])
  const groups = useMemo(() => groupMessages(items), [items])

  const renderItem = (item: RenderedItem): ReactNode => {
    switch (item.kind) {
      case 'user':
        if (!item.text && !item.attachments?.length) return null
        return <UserMessage key={item.id} text={item.text} attachments={item.attachments} timestamp={item.timestamp} />
      case 'assistant':
        return item.text.trim() ? <AssistantMessage key={item.id} text={item.text} timestamp={item.timestamp} /> : null
      case 'reasoning':
        return <Thinking key={item.id} text={item.text} />
      case 'tool':
        return (
          <ToolUse
            key={item.id}
            name={item.name}
            input={item.input}
            status={item.status}
            output={item.output}
          />
        )
      case 'permission':
        return (
          <PermissionPrompt
            key={item.id}
            sessionId={sessionId}
            toolUseId={item.id}
            toolName={item.toolName}
            input={item.input}
            resolved={item.status === 'resolved'}
          />
        )
    }
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      // overflow-x-hidden is the belt to the CSS suspenders (.prose
      // overflow rules in index.css). Even if some future markdown
      // element forgets to constrain itself, this caps it here so the
      // chat as a whole never grows wider than the viewport.
      className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4"
    >
      <div ref={contentRef} className="space-y-5">
        {groups.map((group, i) => {
          if (group.kind === 'message') return renderItem(group.item)
          return (
            <ToolGroup key={`g-${i}`} toolNames={group.toolNames}>
              {group.items.map(renderItem)}
            </ToolGroup>
          )
        })}
        {isBusy && (
          <div className="flex flex-col gap-1 text-xs text-fg-faint">
            <div className="flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" />
              <span className="italic">claude is thinking…</span>
            </div>
            {looksStale && (
              <div className="text-[11px] text-warn ml-5">
                No activity for {Math.round((now - lastEventAtRef.current) / 1000)}s — the
                session may be unresponsive. Close the tab if it stays stuck.
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
})
