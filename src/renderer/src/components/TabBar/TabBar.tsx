import { useEffect } from 'react'
import { useSessionsStore } from '../../store/sessions'
import { useMessagesStore } from '../../store/messages'
import { stopSession } from '../../ipc/bridge'
import { useDragReorder } from '../../hooks/useDragReorder'
import { Tab } from './Tab'

export function TabBar() {
  const { sessions, tabOrder, activeSessionId, setActiveSession, removeSession, reorderTabs } = useSessionsStore()
  const { clearSession } = useMessagesStore()
  const dnd = useDragReorder({ onReorder: reorderTabs, orientation: 'horizontal' })

  const handleClose = (sessionId: string) => {
    stopSession(sessionId)
    removeSession(sessionId)
    clearSession(sessionId)
  }

  // Keyboard shortcuts. Both ctrlKey (Win/Linux) and metaKey (Mac) count —
  // a Mac user pressing Cmd+W expects the active tab to close just like a
  // Windows user pressing Ctrl+W.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      if (e.key === 'w' && activeSessionId) {
        handleClose(activeSessionId)
      }
      if (/^[1-9]$/.test(e.key)) {
        const index = Number(e.key) - 1
        const targetId = tabOrder[index]
        if (targetId) setActiveSession(targetId)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeSessionId, tabOrder])

  if (tabOrder.length === 0) {
    return <div className="h-10 border-b border-divider" />
  }

  return (
    <div className="flex border-b border-divider overflow-x-auto h-10 shrink-0">
      {tabOrder.map(sessionId => {
        const session = sessions[sessionId]
        if (!session) return null
        const dropping = dnd.isDropTarget(sessionId)
        return (
          <div
            key={sessionId}
            {...dnd.bindRow(sessionId)}
            className={`relative min-w-0 ${dnd.isDragging(sessionId) ? 'opacity-40' : ''}`}
          >
            {dropping && dnd.dropPosition === 'before' && <DropLine edge="left" />}
            <Tab
              session={session}
              isActive={sessionId === activeSessionId}
              onActivate={() => setActiveSession(sessionId)}
              onClose={() => handleClose(sessionId)}
            />
            {dropping && dnd.dropPosition === 'after' && <DropLine edge="right" />}
          </div>
        )
      })}
    </div>
  )
}

// Vertical insertion line shown on the left/right edge of the tab a drop
// targets — the horizontal analogue of the sidebar's project DropLine.
function DropLine({ edge }: { edge: 'left' | 'right' }) {
  return (
    <div
      className={`absolute inset-y-1 w-0.5 bg-accent/80 rounded-full pointer-events-none z-10 ${
        edge === 'left' ? 'left-0' : 'right-0'
      }`}
    />
  )
}
