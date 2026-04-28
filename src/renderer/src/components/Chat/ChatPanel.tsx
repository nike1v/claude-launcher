import { useSessionsStore } from '../../store/sessions'
import { MessageList } from './MessageList'
import { InputBar } from '../Input/InputBar'

interface Props {
  sessionId: string
}

export function ChatPanel({ sessionId }: Props) {
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
        <p className="text-white/30 text-xs">Close this tab and reopen the project to retry.</p>
      </div>
    )
  }

  // 'starting' and 'error' early-returned above, so by here status is one of
  // 'ready' | 'busy' | 'closed'. Disable input on a closed session — the
  // child has exited and a send would silently no-op. (The earlier
  // `=== 'starting'` check was dead after the early-return refactor.)
  return (
    <div className="h-full flex flex-col">
      <MessageList sessionId={sessionId} />
      <InputBar sessionId={sessionId} disabled={session.status === 'closed'} />
    </div>
  )
}
