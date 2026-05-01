import { useEffect, useState } from 'react'
import { useSessionsStore } from '../store/sessions'
import { useMessagesStore } from '../store/messages'

const STALE_BUSY_THRESHOLD_MS = 30_000
// 5 s is enough resolution for the badge — finer ticks just burn
// re-renders across every tab and sidebar row.
const TICK_MS = 5_000

// True when the session is in 'busy' status AND no live event has
// arrived for 30 s. Drives the stale-busy warning glyph that appears
// on MessageList, TabBar and the sidebar so a wedged backgrounded
// tab is visible without flipping to it.
//
// Returns false (not stale) if sessionId is undefined / unknown — the
// caller can pass `undefined` directly without guarding.
export function useStaleBusy(sessionId: string | undefined): boolean {
  const isBusy = useSessionsStore(s =>
    sessionId ? s.sessions[sessionId]?.status === 'busy' : false
  )
  const lastEventAt = useMessagesStore(s =>
    sessionId ? s.lastEventAt[sessionId] : undefined
  )
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isBusy) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [isBusy])
  if (!isBusy || lastEventAt === undefined) return false
  return now - lastEventAt > STALE_BUSY_THRESHOLD_MS
}
