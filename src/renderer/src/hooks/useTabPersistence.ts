import { useEffect, useRef } from 'react'
import { useSessionsStore } from '../store/sessions'
import { useProjectsStore } from '../store/projects'
import { useMessagesStore } from '../store/messages'
import {
  loadTabs,
  saveTabs,
  startSession,
  loadSessionHistory
} from '../ipc/bridge'
import type { PersistedTabs, Session } from '../../../shared/types'

// Restore previously-open tabs once the projects list is available, then
// persist the current tab state whenever it changes.
export function useTabPersistence(): void {
  const projects = useProjectsStore(s => s.projects)
  const restoredRef = useRef(false)
  const restoringRef = useRef(false)

  // 1. Restore tabs after projects load.
  useEffect(() => {
    if (restoredRef.current || restoringRef.current) return
    if (!projects.length) return // wait until projects are known

    restoringRef.current = true
    void restoreTabs(projects.map(p => p.id)).finally(() => {
      restoredRef.current = true
      restoringRef.current = false
    })
  }, [projects])

  // 2. Persist tab state on every change — but only after restore has run,
  //    so we don't overwrite the on-disk state with an empty snapshot.
  useEffect(() => {
    return useSessionsStore.subscribe((state) => {
      if (!restoredRef.current) return
      const persisted = serializeTabs(state.sessions, state.tabOrder, state.activeSessionId)
      saveTabs(persisted)
    })
  }, [])
}

async function restoreTabs(knownProjectIds: string[]): Promise<void> {
  let saved: PersistedTabs
  try {
    saved = await loadTabs()
  } catch {
    return
  }
  if (!saved.tabs.length) return

  const known = new Set(knownProjectIds)
  const restorable = saved.tabs.filter(
    t => t.claudeSessionId && known.has(t.projectId)
  )
  if (!restorable.length) return

  const { addSession, setActiveSession } = useSessionsStore.getState()
  const { prependEvents } = useMessagesStore.getState()
  const { setActiveProjectId } = useProjectsStore.getState()

  let firstRestoredId: string | null = null
  let activeRestoredId: string | null = null

  for (let i = 0; i < restorable.length; i++) {
    const tab = restorable[i]
    try {
      const [events, sessionId] = await Promise.all([
        loadSessionHistory(tab.projectId, tab.claudeSessionId),
        startSession(tab.projectId, tab.claudeSessionId)
      ])
      prependEvents(sessionId, events)
      addSession({
        id: sessionId,
        projectId: tab.projectId,
        claudeSessionId: tab.claudeSessionId,
        status: 'starting',
        hasUnread: false,
        lastModel: tab.lastModel,
        lastContextWindow: tab.lastContextWindow
      })
      if (firstRestoredId === null) firstRestoredId = sessionId
      // Map the saved active index (in the saved list) to the restored tab.
      if (saved.activeIndex !== null && saved.tabs[saved.activeIndex] === tab) {
        activeRestoredId = sessionId
      }
    } catch {
      // Skip tabs that fail to restore (e.g. transport error, missing CLI).
    }
  }

  const finalActive = activeRestoredId ?? firstRestoredId
  setActiveSession(finalActive)
  if (finalActive) {
    const session = useSessionsStore.getState().sessions[finalActive]
    if (session) setActiveProjectId(session.projectId)
  }
}

function serializeTabs(
  sessions: Record<string, Session>,
  tabOrder: string[],
  activeSessionId: string | null
): PersistedTabs {
  const tabs = tabOrder
    .map(id => sessions[id])
    .filter((s): s is Session => !!s && !!s.claudeSessionId)
    .map(s => ({
      projectId: s.projectId,
      claudeSessionId: s.claudeSessionId!,
      lastModel: s.lastModel,
      lastContextWindow: s.lastContextWindow
    }))

  let activeIndex: number | null = null
  const activeClaudeId = activeSessionId ? sessions[activeSessionId]?.claudeSessionId : undefined
  if (activeClaudeId) {
    const idx = tabs.findIndex(t => t.claudeSessionId === activeClaudeId)
    activeIndex = idx === -1 ? null : idx
  }

  return { tabs, activeIndex }
}
