import { useEffect, useState } from 'react'
import { useSessionsStore } from '../store/sessions'
import { useMessagesStore } from '../store/messages'

const STALE_BUSY_THRESHOLD_MS = 30_000
// 5 s is enough resolution for the badge — finer ticks just burn
// re-renders across every tab and sidebar row.
const TICK_MS = 5_000

// True when the session is in-flight ('busy' or 'interrupting') AND
// no live event has arrived for 30 s. Drives the stale-busy warning
// glyph that appears on MessageList, TabBar and the sidebar so a
// wedged backgrounded tab is visible without flipping to it.
//
// 'interrupting' is included because a Stop click that the provider
// never honours stays stuck in that state forever — exactly the case
// the user most needs the indicator for.
//
// Returns false (not stale) if sessionId is undefined / unknown — the
// caller can pass `undefined` directly without guarding.
export function useStaleBusy(sessionId: string | undefined): boolean {
  const inFlight = useSessionsStore(s => {
    if (!sessionId) return false
    const status = s.sessions[sessionId]?.status
    return status === 'busy' || status === 'interrupting'
  })
  const lastEventAt = useMessagesStore(s =>
    sessionId ? s.lastEventAt[sessionId] : undefined
  )
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!inFlight) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [inFlight])
  if (!inFlight || lastEventAt === undefined) return false
  return now - lastEventAt > STALE_BUSY_THRESHOLD_MS
}
