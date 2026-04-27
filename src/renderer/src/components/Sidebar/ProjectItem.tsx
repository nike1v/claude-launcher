import { Pencil, Trash2 } from 'lucide-react'
import type { Project } from '../../../../shared/types'
import { useSessionsStore } from '../../store/sessions'
import { useProjectsStore } from '../../store/projects'
import { startSession } from '../../ipc/bridge'
import { StatusDot } from '../StatusDot'

interface Props {
  project: Project
  isActive: boolean
  onEdit: (project: Project) => void
}

export function ProjectItem({ project, isActive, onEdit }: Props): JSX.Element {
  const { addSession, setActiveSession } = useSessionsStore()
  const { setActiveProjectId, removeProject } = useProjectsStore()
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
    const sessionId = await startSession(project.id)
    addSession({
      id: sessionId,
      projectId: project.id,
      status: 'starting',
      hasUnread: false
    })
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

  return (
    <div
      onClick={handleClick}
      className={`group relative flex items-center w-full px-3 py-1.5 rounded text-sm cursor-pointer transition-colors
        ${isActive
          ? 'bg-white/10 text-white'
          : 'text-white/60 hover:bg-white/5 hover:text-white/90'
        }`}
    >
      <StatusDot status={sessionStatus} className="mr-2" />
      <span className="flex-1 truncate pr-12">{project.name}</span>
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={handleEdit}
          className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white"
          title="Edit project"
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="p-1 rounded hover:bg-red-500/20 text-white/50 hover:text-red-300"
          title="Remove project"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}
