import { useEffect } from 'react'
import { useSessionsStore } from './store/sessions'
import { useIpcListeners } from './ipc/listeners'
import { useTabPersistence } from './hooks/useTabPersistence'
import { Sidebar } from './components/Sidebar/Sidebar'
import { TabBar } from './components/TabBar/TabBar'
import { ChatPanel } from './components/Chat/ChatPanel'
import { StatusBar } from './components/StatusBar/StatusBar'

export function App(): JSX.Element {
  useIpcListeners()
  useTabPersistence()

  const { tabOrder, activeSessionId } = useSessionsStore()

  useEffect(() => {
    window.electronAPI.invoke('environments:load', {})
    window.electronAPI.invoke('projects:load', {})
  }, [])

  return (
    <div className="flex h-screen bg-[#0d0d0d] text-[#e5e5e5] overflow-hidden">
      {/* Sidebar */}
      <div className="w-56 shrink-0 border-r border-white/10 flex flex-col">
        <Sidebar />
      </div>

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0">
        <TabBar />
        <div className="flex-1 overflow-hidden">
          {tabOrder.map(sessionId => (
            <div
              key={sessionId}
              className={activeSessionId === sessionId ? 'h-full' : 'hidden'}
            >
              <ChatPanel sessionId={sessionId} />
            </div>
          ))}
          {tabOrder.length === 0 && (
            <div className="h-full flex items-center justify-center text-white/30 text-sm">
              Select a project from the sidebar to start a session
            </div>
          )}
        </div>
        <StatusBar />
      </div>
    </div>
  )
}
