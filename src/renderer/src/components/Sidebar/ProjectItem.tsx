import { useState } from 'react'
import { MessageSquarePlus, Pencil, Trash2, AlertTriangle } from 'lucide-react'
import type { Project } from '../../../../shared/types'
import { useSessionsStore } from '../../store/sessions'
import { useProjectsStore } from '../../store/projects'
import { useMessagesStore } from '../../store/messages'
import { loadSessionHistory, startSession, stopSession } from '../../ipc/bridge'
import { StatusDot } from '../StatusDot'
import { ConfirmDialog } from '../ConfirmDialog'
import { useStaleBusy } from '../../lib/use-stale-busy'

interface Props {
  project: Project
  isActive: boolean
  onEdit: (project: Project) => void
}

// Module-level guard: rapid clicks on a project before the first
// startSession resolves used to spawn a tab per click, because the
// "existing tab?" check ran against a store that hadn't been written to
// yet. We can't pre-create a Session synchronously (the id is generated
// on the main side), so instead we lock the projectId for the duration
// of the in-flight start and silently drop concurrent clicks.
const startingProjects = new Set<string>()

export function ProjectItem({ project, isActive, onEdit }: Props) {
  const { addSession, setActiveSession, removeSession } = useSessionsStore()
  const { setActiveProjectId, removeProject, updateProject } = useProjectsStore()
  const { clearSession } = useMessagesStore()
  const [confirmReset, setConfirmReset] = useState(false)
  // Mirror the tab's status dot in the sidebar so the user can see which
  // projects are working / errored / closed without flipping tabs. We pick
  // the most recently added session for the project — there's at most one
  // open per project today, but the reverse-find keeps it future-proof.
  const projectSession = useSessionsStore(s => {
    for (let i = s.tabOrder.length - 1; i >= 0; i--) {
      const sess = s.sessions[s.tabOrder[i]]
      if (sess?.projectId === project.id) return sess
    }
    return undefined
  })
  const sessionStatus = projectSession?.status
  const looksStale = useStaleBusy(projectSession?.id)

  const handleClick = async () => {
    setActiveProjectId(project.id)
    const { sessions, tabOrder } = useSessionsStore.getState()
    const existingId = [...tabOrder].reverse().find(id => sessions[id]?.projectId === project.id)
    if (existingId) {
      setActiveSession(existingId)
      return
    }
    if (startingProjects.has(project.id)) return
    startingProjects.add(project.id)
    try {
      const resume = project.lastSessionRef
      let sessionId: string
      try {
        sessionId = await startSession(project.id, resume)
      } catch (err) {
        // The IPC layer rejects when the project / env disappeared between
        // store load and click, or when transport spawn ENOENTs. Without
        // this log the user just sees nothing happen on click — surface it.
        console.error('[ProjectItem] startSession failed for', project.id, err)
        return
      }
      addSession({
        id: sessionId,
        projectId: project.id,
        sessionRef: resume,
        status: 'starting',
        hasUnread: false,
        // Pull cached values off the project so the StatusBar shows the
        // right model + context window immediately instead of flashing
        // empty during the SSH cold-start window. Updated by listeners.ts
        // on every init / result, so this is always current as of the
        // last successful run.
        lastModel: project.lastModel,
        lastContextWindow: project.lastContextWindow,
        lastUsedTokens: project.lastUsedTokens
      })
      if (resume) {
        try {
          const result = await loadSessionHistory(project.id, resume)
          if (result.events.length) {
            useMessagesStore.getState().prependEvents(sessionId, result.events)
          }
          if (result.diagnostic) {
            console.warn(`[history] ${resume}: ${result.diagnostic}`)
          }
        } catch (err) {
          console.warn('[ProjectItem] loadSessionHistory failed for', resume, err)
        }
      }
    } finally {
      startingProjects.delete(project.id)
    }
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    onEdit(project)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (window.confirm(`Remove project "${project.name}"?`)) {
      removeProject(project.id)
    }
  }

  const openResetConfirm = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!project.lastSessionRef) return
    setConfirmReset(true)
  }

  // Forget the pinned sessionRef and immediately spawn a blank session,
  // mirroring claude CLI's `/clear`: the previous transcript stays on
  // disk but is no longer attached, and the user lands in an empty chat
  // ready to type. Closes any live tab for this project first — without
  // that, the open tab keeps its sessionRef in the sessions store and
  // the user would still be talking to the now-detached conversation.
  //
  // Order matters: stop the live process → drop the renderer session
  // entry → drop messages → clear the project pin → start fresh.
  // listeners.ts re-pins on the new session's first init, so we're back
  // to the write-once steady state with a different conversation.
  const handleResetConfirmed = async () => {
    setConfirmReset(false)
    const { sessions, tabOrder } = useSessionsStore.getState()
    for (const id of tabOrder) {
      if (sessions[id]?.projectId === project.id) {
        stopSession(id)
        removeSession(id)
        clearSession(id)
      }
    }
    updateProject({
      ...project,
      lastSessionRef: undefined,
      // Drop the cached model + context too — they were measured
      // against the now-forgotten conversation. The next session's
      // first init will repopulate them.
      lastModel: undefined,
      lastContextWindow: undefined
    })

    // Spawn a blank session right away. No resume ref, no history load —
    // we're explicitly starting clean. The startingProjects guard
    // shared with handleClick keeps a rapid double-click from spawning
    // two tabs.
    setActiveProjectId(project.id)
    if (startingProjects.has(project.id)) return
    startingProjects.add(project.id)
    try {
      let sessionId: string
      try {
        sessionId = await startSession(project.id)
      } catch (err) {
        console.error('[ProjectItem] startSession after reset failed for', project.id, err)
        return
      }
      addSession({
        id: sessionId,
        projectId: project.id,
        status: 'starting',
        hasUnread: false
      })
    } finally {
      startingProjects.delete(project.id)
    }
  }

  // Tab-count for the open project, surfaced in the confirm copy so the
  // user knows the click will close active tabs. Counted at render time
  // because the user might open / close tabs between hovering the
  // button and confirming.
  const openTabCount = useSessionsStore(s =>
    s.tabOrder.reduce((n, id) => (s.sessions[id]?.projectId === project.id ? n + 1 : n), 0)
  )

  return (
    // Active-project visual: accent-tinted background + a 2px accent
    // strip on the left edge. The strip is the always-on cue (works
    // even with the desaturated Slate palette where the bg tint is
    // barely visible).
    <div
      onClick={handleClick}
      className={`group relative flex items-center w-full px-3 py-1.5 rounded text-sm cursor-pointer transition-colors
        ${isActive
          ? 'bg-accent/12 text-fg'
          : 'text-fg-muted hover:bg-elevated hover:text-fg'
        }`}
    >
      {isActive && (
        <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-r pointer-events-none" />
      )}
      <StatusDot status={sessionStatus} className="mr-2" />
      {looksStale && (
        <AlertTriangle
          size={11}
          className="text-warn shrink-0 mr-1.5"
          aria-label="Session may be unresponsive"
        >
          <title>No activity for a while — session may be unresponsive</title>
        </AlertTriangle>
      )}
      {/* pr-16 (4rem) reserves room for up to 3 hover icons; the reset
          button only renders when there's actually a pinned conversation
          to reset, so the gap shrinks back for never-opened projects. */}
      <span className="flex-1 truncate pr-16">{project.name}</span>
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {project.lastSessionRef && (
          <button
            type="button"
            onClick={openResetConfirm}
            className="p-1 rounded hover:bg-elevated text-fg-faint hover:text-fg"
            title="Start fresh conversation"
          >
            <MessageSquarePlus size={12} />
          </button>
        )}
        <button
          type="button"
          onClick={handleEdit}
          className="p-1 rounded hover:bg-elevated text-fg-faint hover:text-fg"
          title="Edit project"
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="p-1 rounded hover:bg-danger/20 text-fg-faint hover:text-danger"
          title="Remove project"
        >
          <Trash2 size={12} />
        </button>
      </div>
      {confirmReset && (
        <ConfirmDialog
          title={`Start fresh conversation in "${project.name}"?`}
          tone="danger"
          confirmLabel="Reset conversation"
          body={
            <>
              <p>The transcript on disk stays untouched — this unpins the resume reference and opens a new, empty session for this project right away (like claude CLI&apos;s <code>/clear</code>).</p>
              {openTabCount > 0 && (
                <p className="mt-2 text-danger">
                  {openTabCount === 1 ? 'The currently open tab' : `${openTabCount} open tabs`} for this project will be closed and reopened blank.
                </p>
              )}
            </>
          }
          onConfirm={handleResetConfirmed}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  )
}
