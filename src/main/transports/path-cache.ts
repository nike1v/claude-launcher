import type { HostType } from '../../shared/types'

// Per-host probe output cache: PATH (the login-shell-resolved one) and
// HOME (the remote user's home directory). Populated by the probe and
// consumed by spawn(). We use it instead of wrapping every spawn in
// `bash -lc 'claude "$@"'` because the login-shell wrapper
// (a) re-sources the user profile on every turn and (b) interferes
// with stdin in some setups — claude's stream-json mode then sees
// EOF and bails with "no stdin data received in 3s".
//
// HOME is captured so transports can compose absolute installer-default
// paths client-side (e.g. <home>/.opencode/bin) without threading
// shell tilde expansion through wsl.exe / ssh argv.
interface CachedProbe {
  path: string
  home?: string
}

const cache = new Map<string, CachedProbe>()

export function pathCacheKey(host: HostType): string {
  if (host.kind === 'wsl') return `wsl:${host.distro}`
  if (host.kind === 'ssh') {
    const target = host.user ? `${host.user}@${host.host}` : host.host
    return `ssh:${target}:${host.port ?? ''}`
  }
  return 'local'
}

export function setCachedProbe(host: HostType, path: string, home?: string): void {
  cache.set(pathCacheKey(host), { path, home })
}

export function getCachedProbe(host: HostType): CachedProbe | undefined {
  return cache.get(pathCacheKey(host))
}

// Backwards-compat wrappers for callers / tests that only care about
// the PATH field.
export function setCachedPath(host: HostType, path: string): void {
  setCachedProbe(host, path)
}

export function getCachedPath(host: HostType): string | undefined {
  return cache.get(pathCacheKey(host))?.path
}
