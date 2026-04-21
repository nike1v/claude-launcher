import { useSessionsStore } from '../../store/sessions'
import { MessageList } from './MessageList'
import { InputBar } from '../Input/InputBar'

interface Props {
  sessionId: string
}

export function ChatPanel({ sessionId }: Props): JSX.Element {
  const { sessions } = useSessionsStore()
  const session = sessions[sessionId]

  if (!session) return <></>

  if (session.status === 'starting') {
    return (
      <div className="h-full flex items-center justify-center text-white/30 text-sm">
        <span className="animate-pulse">Starting session…</span>
      </div>
    )
  }

  if (session.status === 'error') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <p className="text-red-400 text-sm">{session.errorMessage ?? 'Session error'}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-3 py-1.5 text-xs bg-white/10 rounded hover:bg-white/20"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <MessageList sessionId={sessionId} />
      <InputBar sessionId={sessionId} disabled={session.status === 'starting'} />
    </div>
  )
}
