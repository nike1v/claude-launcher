import { useSessionsStore } from '../../store/sessions'
import { useProjectsStore } from '../../store/projects'
import { useMessagesStore } from '../../store/messages'
import type { InitEvent } from '../../../../shared/types'

const STATUS_COLOR: Record<string, string> = {
  starting: 'bg-yellow-400',
  ready: 'bg-green-400',
  busy: 'bg-blue-400',
  error: 'bg-red-400',
  closed: 'bg-white/20'
}

export function StatusBar(): JSX.Element {
  const { sessions, activeSessionId } = useSessionsStore()
  const { projects } = useProjectsStore()
  const { messagesBySession } = useMessagesStore()

  const session = activeSessionId ? sessions[activeSessionId] : null
  const project = session ? projects.find(p => p.id === session.projectId) : null

  // Extract model + cwd from init event
  const messages = activeSessionId ? (messagesBySession[activeSessionId] ?? []) : []
  const initEvent = messages
    .map(m => m.event)
    .find((e): e is InitEvent => e.type === 'system' && (e as any).subtype === 'init')

  const hostLabel = project
    ? project.host.kind === 'wsl'
      ? `WSL · ${project.host.distro}`
      : `SSH · ${project.host.host}`
    : ''

  return (
    <div className="h-7 border-t border-white/10 flex items-center px-3 gap-3 text-xs text-white/30 shrink-0">
      {session && (
        <>
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLOR[session.status] ?? 'bg-white/20'}`} />
          <span>{hostLabel}</span>
          {initEvent?.cwd && <span className="text-white/20 truncate max-w-48">{initEvent.cwd}</span>}
          {initEvent?.model && <span className="ml-auto text-white/20">{initEvent.model}</span>}
        </>
      )}
    </div>
  )
}
