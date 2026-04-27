import type { HostType } from '../../shared/types'

// Per-host PATH cache populated by the probe and consumed by spawn(). We use
// it instead of wrapping every spawn in `bash -lc 'claude "$@"'` because the
// login-shell wrapper (a) re-sources the user profile on every turn and
// (b) interferes with stdin in some setups — claude's stream-json mode then
// sees EOF and bails with "no stdin data received in 3s".
const cache = new Map<string, string>()

export function pathCacheKey(host: HostType): string {
  if (host.kind === 'wsl') return `wsl:${host.distro}`
  if (host.kind === 'ssh') {
    const target = host.user ? `${host.user}@${host.host}` : host.host
    return `ssh:${target}:${host.port ?? ''}`
  }
  return 'local'
}

export function setCachedPath(host: HostType, path: string): void {
  cache.set(pathCacheKey(host), path)
}

export function getCachedPath(host: HostType): string | undefined {
  return cache.get(pathCacheKey(host))
}
