import type { EnvScrubPattern } from '../providers/types'

// Filter `process.env` by a provider-supplied list of scrub patterns.
// Used by WSL / SSH transports to drop provider-specific OAuth tokens
// before they reach a remote child — the remote has its own credentials
// and shouldn't inherit the launcher's.
export function filteredEnvFor(scrubKeys: readonly EnvScrubPattern[]): NodeJS.ProcessEnv {
  if (scrubKeys.length === 0) return { ...process.env }
  return Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !matchesAny(k, scrubKeys))
  ) as NodeJS.ProcessEnv
}

function matchesAny(key: string, patterns: readonly EnvScrubPattern[]): boolean {
  for (const p of patterns) {
    if ('prefix' in p) {
      if (key.startsWith(p.prefix)) return true
    } else if (key === p.exact) {
      return true
    }
  }
  return false
}
