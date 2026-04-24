import { X } from 'lucide-react'
import type { Session } from '../../../../shared/types'
import { useProjectsStore } from '../../store/projects'

interface Props {
  session: Session
  isActive: boolean
  onActivate: () => void
  onClose: () => void
}

const STATUS_DOT: Record<Session['status'], string> = {
  starting: 'bg-yellow-400 animate-pulse',
  ready: 'bg-green-400',
  busy: 'bg-blue-400 animate-pulse',
  error: 'bg-red-400',
  closed: 'bg-white/20'
}

export function Tab({ session, isActive, onActivate, onClose }: Props): JSX.Element {
  const { projects } = useProjectsStore()
  const project = projects.find(p => p.id === session.projectId)

  const hostLabel = project
    ? project.host.kind === 'wsl'
      ? 'WSL'
      : project.host.kind === 'ssh'
      ? 'SSH'
      : 'Local'
    : '?'

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 border-r border-white/10 cursor-pointer min-w-0 max-w-48 group
        ${isActive ? 'bg-[#1a1a1a] text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}`}
      onClick={onActivate}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[session.status]}`} />
      <span className="text-xs truncate flex-1">
        <span className="text-white/30 mr-1">{hostLabel}</span>
        {project?.name ?? 'Unknown'}
      </span>
      {session.hasUnread && !isActive && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
      )}
      <button
        onClick={e => { e.stopPropagation(); onClose() }}
        className="shrink-0 opacity-0 group-hover:opacity-100 text-white/40 hover:text-white transition-opacity"
      >
        <X size={12} />
      </button>
    </div>
  )
}
