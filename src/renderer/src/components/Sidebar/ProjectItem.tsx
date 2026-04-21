import type { Project } from '../../../../shared/types'
import { useSessionsStore } from '../../store/sessions'
import { startSession } from '../../ipc/bridge'

interface Props {
  project: Project
  isActive: boolean
}

export function ProjectItem({ project, isActive }: Props): JSX.Element {
  const { addSession } = useSessionsStore()

  const handleClick = async () => {
    const sessionId = await startSession(project.id)
    addSession({
      id: sessionId,
      projectId: project.id,
      status: 'starting',
      hasUnread: false
    })
  }

  return (
    <button
      onClick={handleClick}
      className={`w-full text-left px-3 py-1.5 rounded text-sm truncate transition-colors
        ${isActive
          ? 'bg-white/10 text-white'
          : 'text-white/60 hover:bg-white/5 hover:text-white/90'
        }`}
    >
      {project.name}
    </button>
  )
}
