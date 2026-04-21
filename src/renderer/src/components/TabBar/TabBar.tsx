import { useEffect } from 'react'
import { useSessionsStore } from '../../store/sessions'
import { useMessagesStore } from '../../store/messages'
import { stopSession } from '../../ipc/bridge'
import { Tab } from './Tab'

export function TabBar(): JSX.Element {
  const { sessions, tabOrder, activeSessionId, setActiveSession, removeSession } = useSessionsStore()
  const { clearSession } = useMessagesStore()

  const handleClose = (sessionId: string) => {
    stopSession(sessionId)
    removeSession(sessionId)
    clearSession(sessionId)
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'w' && activeSessionId) {
        handleClose(activeSessionId)
      }
      if (e.ctrlKey && /^[1-9]$/.test(e.key)) {
        const index = Number(e.key) - 1
        const targetId = tabOrder[index]
        if (targetId) setActiveSession(targetId)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeSessionId, tabOrder])

  if (tabOrder.length === 0) {
    return <div className="h-10 border-b border-white/10" />
  }

  return (
    <div className="flex border-b border-white/10 overflow-x-auto h-10 shrink-0">
      {tabOrder.map(sessionId => {
        const session = sessions[sessionId]
        if (!session) return null
        return (
          <Tab
            key={sessionId}
            session={session}
            isActive={sessionId === activeSessionId}
            onActivate={() => setActiveSession(sessionId)}
            onClose={() => handleClose(sessionId)}
          />
        )
      })}
    </div>
  )
}
