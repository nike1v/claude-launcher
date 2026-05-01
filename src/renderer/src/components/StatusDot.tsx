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

// Use semantic tokens so the dots stay legible across both themes (light
// gets darker red/green/amber for AA contrast on the pale panel; dark
// keeps the brighter palette for legibility on near-black). The accent
// token covers the "busy" pulse — same hue as active-tab indicator.
const TONE: Record<Session['status'], string> = {
  starting: 'bg-warn status-dot-pulse',
  ready: 'bg-success',
  busy: 'bg-accent status-dot-pulse',
  error: 'bg-danger',
  closed: 'bg-elevated'
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
export function StatusDot({ status, size = 'xs', className = '' }: Props) {
  const tone = status ? TONE[status] : 'bg-elevated'
  const title = status ? TITLE[status] : 'No active session'
  const dim = size === 'sm' ? 'w-2 h-2' : 'w-1.5 h-1.5'
  return (
    <span
      title={title}
      className={`shrink-0 rounded-full ${dim} ${tone} ${className}`}
    />
  )
}
