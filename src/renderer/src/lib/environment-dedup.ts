import type { Environment, HostType } from '../../../shared/types'

// True when two host configs target the same connection. Used to enforce
// that we can't have two Local environments, two WSL envs on the same
// distro, or two SSH envs that resolve to the same user@host (port is
// excluded — different ports against the same logical box are commonly
// the same machine, and SSH config aliases hide port anyway).
export function isSameEnvironmentTarget(a: HostType, b: HostType): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'local' && b.kind === 'local') return true
  if (a.kind === 'wsl' && b.kind === 'wsl') {
    return normalizeDistro(a.distro) === normalizeDistro(b.distro)
  }
  if (a.kind === 'ssh' && b.kind === 'ssh') {
    return (a.user ?? '').toLowerCase() === (b.user ?? '').toLowerCase()
      && a.host.toLowerCase() === b.host.toLowerCase()
  }
  return false
}

export function findDuplicateEnvironment(
  envs: ReadonlyArray<Environment>,
  config: HostType,
  excludeId?: string
): Environment | null {
  for (const env of envs) {
    if (excludeId && env.id === excludeId) continue
    if (isSameEnvironmentTarget(env.config, config)) return env
  }
  return null
}

function normalizeDistro(d: string): string {
  return d.trim().toLowerCase()
}
