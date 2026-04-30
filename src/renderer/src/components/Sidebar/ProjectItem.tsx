import { useState } from 'react'
import { MessageSquarePlus, Pencil, Trash2 } from 'lucide-react'
import type { Project } from '../../../../shared/types'
import { useSessionsStore } from '../../store/sessions'
import { useProjectsStore } from '../../store/projects'
import { useMessagesStore } from '../../store/messages'
import { loadSessionHistory, startSession, stopSession } from '../../ipc/bridge'
import { StatusDot } from '../StatusDot'
import { ConfirmDialog } from '../ConfirmDialog'

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
  const sessionStatus = useSessionsStore(s => {
    for (let i = s.tabOrder.length - 1; i >= 0; i--) {
      const sess = s.sessions[s.tabOrder[i]]
      if (sess?.projectId === project.id) return sess.status
    }
    return undefined
  })

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
        lastContextWindow: project.lastContextWindow
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

  // Forget the pinned sessionRef so the next click on this project
  // starts a fresh conversation instead of resuming. Closes any live tab
  // for this project first — without that, the open tab keeps its
  // sessionRef in the sessions store and the user would still be
  // talking to the now-detached conversation.
  //
  // Order matters: stop the live process → drop the renderer session
  // entry → drop messages → finally clear the project pin. listeners.ts
  // re-pins on the next session's first init, so we're back to the
  // write-once steady state with a different conversation.
  const handleResetConfirmed = () => {
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
            title="Start fresh conversation next time"
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
              <p>The transcript on disk stays untouched — this just unpins the resume reference so the next click on this project starts a new claude session.</p>
              {openTabCount > 0 && (
                <p className="mt-2 text-danger">
                  {openTabCount === 1 ? 'The currently open tab' : `${openTabCount} open tabs`} for this project will be closed and reopened blank when you click again.
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
