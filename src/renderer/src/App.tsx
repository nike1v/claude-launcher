import { useEffect } from 'react'
import { useSessionsStore } from './store/sessions'
import { useThemeStore } from './store/theme'
import { useIpcListeners } from './ipc/listeners'
import { useTabPersistence } from './hooks/useTabPersistence'
import { Sidebar } from './components/Sidebar/Sidebar'
import { TabBar } from './components/TabBar/TabBar'
import { ChatPanel } from './components/Chat/ChatPanel'
import { StatusBar } from './components/StatusBar/StatusBar'

// Browser-style zoom shortcuts. Both ctrlKey (Win/Linux) and metaKey (mac)
// trigger the action — Electron doesn't auto-bind these, and the default
// menu accelerators we don't ship would have only handled one platform.
function useZoomShortcuts(): void {
  const zoomIn = useThemeStore(s => s.zoomIn)
  const zoomOut = useThemeStore(s => s.zoomOut)
  const zoomReset = useThemeStore(s => s.zoomReset)
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      // `=` is the unshifted key for `+`. Browsers fire `=` for Ctrl+= and
      // Ctrl++ alike, so handling `=` covers both. `NumpadAdd` covers the
      // numpad on full-size keyboards.
      if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
        e.preventDefault()
        zoomIn()
      } else if (e.key === '-' || e.code === 'NumpadSubtract') {
        e.preventDefault()
        zoomOut()
      } else if (e.key === '0' || e.code === 'Numpad0') {
        e.preventDefault()
        zoomReset()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [zoomIn, zoomOut, zoomReset])
}

export function App() {
  useIpcListeners()
  useTabPersistence()
  useZoomShortcuts()

  // Select per-field so App doesn't re-render on every status / hasUnread
  // event landing in `sessions[id]` — only the actual tab list / active
  // pointer matter at this level. Cuts re-renders from O(events) to
  // O(tab-changes).
  const tabOrder = useSessionsStore(s => s.tabOrder)
  const activeSessionId = useSessionsStore(s => s.activeSessionId)

  useEffect(() => {
    window.electronAPI.invoke('environments:load', {})
    window.electronAPI.invoke('projects:load', {})
  }, [])

  return (
    <div className="flex h-screen bg-app text-fg overflow-hidden">
      {/* Sidebar — sits on bg-card (a hair lighter than bg-app) so the
          right-edge hairline + tonal shift read as a distinct panel
          rather than "everything is one black surface". */}
      <div className="w-56 shrink-0 border-r border-divider flex flex-col bg-card">
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
            <div className="h-full flex items-center justify-center text-fg-faint text-sm">
              Select a project from the sidebar to start a session
            </div>
          )}
        </div>
        <StatusBar />
      </div>
    </div>
  )
}
