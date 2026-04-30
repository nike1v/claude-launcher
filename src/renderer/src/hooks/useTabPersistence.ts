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
  } catch (err) {
    console.warn('[restoreTabs] loadTabs failed:', err)
    return
  }
  if (!saved.tabs.length) return

  const known = new Set(knownProjectIds)
  const restorable = saved.tabs.filter(
    t => t.sessionRef && known.has(t.projectId)
  )
  // Log every dropped tab with the reason — this is the most common cause
  // of "history doesn't load": the tab persisted before claude returned a
  // session_id, or the project was deleted, so we have nothing to resume.
  // Surface dropped tabs only when something's actually wrong — both
  // these branches mean the user will see fewer tabs than they had at
  // app close, and the warning explains why if they go looking.
  for (const t of saved.tabs) {
    if (!t.sessionRef) {
      console.warn(`[restoreTabs] dropping tab project=${t.projectId} — no sessionRef saved (session never reached system:init before app close)`)
    } else if (!known.has(t.projectId)) {
      console.warn(`[restoreTabs] dropping tab project=${t.projectId} sess=${t.sessionRef} — project no longer in projects.json`)
    }
  }
  if (!restorable.length) return

  const { addSession, setActiveSession } = useSessionsStore.getState()
  const { prependEvents } = useMessagesStore.getState()
  const { setActiveProjectId } = useProjectsStore.getState()

  // session-manager.startSession returns the sessionId synchronously
  // (probe + spawn run in background and emit status events as they
  // settle). So we just `for`-loop, addSession after each fast IPC
  // call resolves, and the TabBar paints all N tabs in 'starting'
  // state within milliseconds — instead of waiting for every cold
  // SSH probe to complete first.
  //
  // History load is fire-and-forget: events flow into the messages
  // store via prependEvents whenever the IPC resolves, which is fine
  // because the session entry is already in the sessions store and
  // MessageList just shows whatever's in messagesBySession[id].
  let firstRestoredId: string | null = null
  let activeRestoredId: string | null = null
  for (let i = 0; i < restorable.length; i++) {
    const tab = restorable[i]
    let sessionId: string
    try {
      sessionId = await startSession(tab.projectId, tab.sessionRef)
    } catch (err) {
      // The IPC layer rejects only when the project / env disappeared
      // between save and restore. Fabricate a UUID + flag the tab as
      // error so ChatPanel surfaces "close and reopen"; the renderer-
      // side id is unknown to main, so any sendMessage would silently
      // no-op without this flag.
      console.error('[restoreTabs] startSession failed for', tab.projectId, err)
      sessionId = crypto.randomUUID()
      addSession({
        id: sessionId,
        projectId: tab.projectId,
        sessionRef: tab.sessionRef,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Could not start session',
        hasUnread: false,
        lastModel: tab.lastModel,
        lastContextWindow: tab.lastContextWindow
      })
      if (firstRestoredId === null) firstRestoredId = sessionId
      if (saved.activeIndex !== null && saved.tabs[saved.activeIndex] === tab) {
        activeRestoredId = sessionId
      }
      continue
    }
    addSession({
      id: sessionId,
      projectId: tab.projectId,
      sessionRef: tab.sessionRef,
      status: 'starting',
      hasUnread: false,
      lastModel: tab.lastModel,
      lastContextWindow: tab.lastContextWindow
    })
    if (firstRestoredId === null) firstRestoredId = sessionId
    if (saved.activeIndex !== null && saved.tabs[saved.activeIndex] === tab) {
      activeRestoredId = sessionId
    }
    // Fire-and-forget: history flows in when ready, no point blocking
    // the next tab's startSession on it.
    void loadSessionHistory(tab.projectId, tab.sessionRef)
      .then(result => {
        if (result.events.length) prependEvents(sessionId, result.events)
        // Only surface a diagnostic when there is one — it means main
        // returned [] for a non-trivial reason (slug mismatch, ssh
        // refused, file missing, etc.) and the user is looking at an
        // empty history. The success-path used to log here too; that
        // was useful while debugging the SSH history bug, noise now.
        if (result.diagnostic) {
          console.warn(`[history] ${tab.sessionRef}: ${result.diagnostic}`)
        }
      })
      .catch(err => console.warn('[restoreTabs] loadSessionHistory failed for', tab.sessionRef, err))
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
    .filter((s): s is Session => !!s && !!s.sessionRef)
    .map(s => ({
      projectId: s.projectId,
      sessionRef: s.sessionRef!,
      lastModel: s.lastModel,
      lastContextWindow: s.lastContextWindow
    }))

  let activeIndex: number | null = null
  const activeSessionRef = activeSessionId ? sessions[activeSessionId]?.sessionRef : undefined
  if (activeSessionRef) {
    const idx = tabs.findIndex(t => t.sessionRef === activeSessionRef)
    activeIndex = idx === -1 ? null : idx
  }

  return { tabs, activeIndex }
}
