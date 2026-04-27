import type { Session } from '../../../shared/types'

interface Props {
  // Undefined when there's no session for the project — renders the dot in
  // the dim "no activity" tone so the slot stays the same width either way.
  status?: Session['status']
  // size in tailwind units. Default matches the small chips used in the
  // sidebar / tabs.
  size?: 'xs' | 'sm'
  className?: string
}

const TONE: Record<Session['status'], string> = {
  starting: 'bg-yellow-400 status-dot-pulse',
  ready: 'bg-green-400',
  busy: 'bg-blue-400 status-dot-pulse',
  error: 'bg-red-400',
  closed: 'bg-white/20'
}

const TITLE: Record<Session['status'], string> = {
  starting: 'Starting…',
  ready: 'Ready',
  busy: 'Working…',
  error: 'Error',
  closed: 'Closed'
}

// Single source of truth for the per-session colored status dot. Used in
// the tab bar and the sidebar project list so both surfaces always agree
// on what's happening for a given session.
export function StatusDot({ status, size = 'xs', className = '' }: Props): JSX.Element {
  const tone = status ? TONE[status] : 'bg-white/10'
  const title = status ? TITLE[status] : 'No active session'
  const dim = size === 'sm' ? 'w-2 h-2' : 'w-1.5 h-1.5'
  return (
    <span
      title={title}
      className={`shrink-0 rounded-full ${dim} ${tone} ${className}`}
    />
  )
}
