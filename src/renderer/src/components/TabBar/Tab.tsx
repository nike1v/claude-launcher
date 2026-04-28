import { X } from 'lucide-react'
import type { Session } from '../../../../shared/types'
import { useProjectsStore } from '../../store/projects'
import { useEnvironmentsStore } from '../../store/environments'
import { StatusDot } from '../StatusDot'

interface Props {
  session: Session
  isActive: boolean
  onActivate: () => void
  onClose: () => void
}

export function Tab({ session, isActive, onActivate, onClose }: Props) {
  const { projects } = useProjectsStore()
  const { environments } = useEnvironmentsStore()
  const project = projects.find(p => p.id === session.projectId)
  const env = project ? environments.find(e => e.id === project.environmentId) : undefined

  const hostLabel = env
    ? env.config.kind === 'wsl'
      ? 'WSL'
      : env.config.kind === 'ssh'
      ? 'SSH'
      : 'Local'
    : '?'

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 border-r border-white/10 cursor-pointer min-w-0 max-w-48 group
        ${isActive ? 'bg-[#1a1a1a] text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}`}
      onClick={onActivate}
    >
      <StatusDot status={session.status} />
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
