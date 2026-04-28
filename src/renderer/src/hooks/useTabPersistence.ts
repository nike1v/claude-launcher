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

  // 2. Persist tab state when the *serialised* shape changes — but only
  //    after restore has run, so we don't overwrite the on-disk state with
  //    an empty snapshot. The naive subscribe-and-write fired tabs.json on
  //    every status event (busy → ready, hasUnread flips, etc.) — i.e. dozens
  //    of writes per turn for what's actually a static shape. Diffing the
  //    serialised JSON skips those non-events.
  useEffect(() => {
    let prevFingerprint: string | null = null
    return useSessionsStore.subscribe((state) => {
      if (!restoredRef.current) return
      const persisted = serializeTabs(state.sessions, state.tabOrder, state.activeSessionId)
      const fingerprint = JSON.stringify(persisted)
      if (fingerprint === prevFingerprint) return
      prevFingerprint = fingerprint
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

  // Fan out per-tab IPC calls in parallel — sequential restore meant N tabs
  // each blocked on a cold SSH probe (up to 25 s) before the UI showed
  // anything. Parallel cuts that to one probe-RTT for the whole restore.
  // Order is preserved by keeping the original index on each result and
  // calling addSession in that order at the end (zustand's tabOrder is
  // append-only).
  const restored = await Promise.all(
    restorable.map(async (tab, idx) => {
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
      let events: import('../../../shared/types').StreamJsonEvent[] = []
      try {
        events = await loadSessionHistory(tab.projectId, tab.claudeSessionId)
      } catch (err) {
        // History unavailable — leave the tab empty; resume still works once
        // the first turn lands.
        console.warn('[restoreTabs] loadSessionHistory failed for', tab.claudeSessionId, err)
      }
      return { idx, tab, sessionId, initialStatus, errorMessage, events }
    })
  )

  let firstRestoredId: string | null = null
  let activeRestoredId: string | null = null
  for (const r of restored) {
    addSession({
      id: r.sessionId,
      projectId: r.tab.projectId,
      claudeSessionId: r.tab.claudeSessionId,
      status: r.initialStatus,
      errorMessage: r.errorMessage,
      hasUnread: false,
      lastModel: r.tab.lastModel,
      lastContextWindow: r.tab.lastContextWindow
    })
    if (r.events.length) prependEvents(r.sessionId, r.events)
    if (firstRestoredId === null) firstRestoredId = r.sessionId
    if (saved.activeIndex !== null && saved.tabs[saved.activeIndex] === r.tab) {
      activeRestoredId = r.sessionId
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
