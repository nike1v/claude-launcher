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
    // Each step is wrapped independently so a transient failure (claude not
    // on PATH, wsl.exe cold-start timeout, missing JSONL) doesn't silently
    // drop the tab from in-memory state — which would then cascade into the
    // next persistence write overwriting tabs.json without it. The tab's
    // claudeSessionId from disk is preserved either way; the user can
    // re-send a message to retry the connection.
    let sessionId: string
    let initialStatus: import('../../../shared/types').Session['status'] = 'starting'
    let errorMessage: string | undefined
    try {
      sessionId = await startSession(tab.projectId, tab.claudeSessionId)
    } catch (err) {
      // startSession rejects when the IPC layer itself errors (project /
      // env disappeared between save and restore). Fabricating a UUID lets
      // us preserve the tab in tabs.json (so it survives the next persist
      // write), but we tag it 'error' so ChatPanel surfaces "close and
      // reopen" — the renderer-side id is unknown to main, so any
      // sendMessage to it would silently no-op without this flag.
      console.error('[restoreTabs] startSession failed for', tab.projectId, err)
      sessionId = crypto.randomUUID()
      initialStatus = 'error'
      errorMessage = err instanceof Error ? err.message : 'Could not start session'
    }
    addSession({
      id: sessionId,
      projectId: tab.projectId,
      claudeSessionId: tab.claudeSessionId,
      status: initialStatus,
      errorMessage,
      hasUnread: false,
      lastModel: tab.lastModel,
      lastContextWindow: tab.lastContextWindow
    })
    try {
      const events = await loadSessionHistory(tab.projectId, tab.claudeSessionId)
      if (events.length) prependEvents(sessionId, events)
    } catch (err) {
      // History unavailable — leave the tab empty; resume still works once
      // the first turn lands.
      console.warn('[restoreTabs] loadSessionHistory failed for', tab.claudeSessionId, err)
    }
    if (firstRestoredId === null) firstRestoredId = sessionId
    // Map the saved active index (in the saved list) to the restored tab.
    if (saved.activeIndex !== null && saved.tabs[saved.activeIndex] === tab) {
      activeRestoredId = sessionId
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
