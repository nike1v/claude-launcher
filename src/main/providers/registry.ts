// Module-level Map state — there's one IProvider per ProviderKind for the
// whole process. Tests use `unregisterAll()` to reset between runs.
// session-manager calls `getProvider(kind)` when starting a session.

import type { ProviderKind } from '../../shared/events'
import type { IProvider } from './types'

const providers = new Map<ProviderKind, IProvider>()

export function register(provider: IProvider): void {
  providers.set(provider.kind, provider)
}

export function getProvider(kind: ProviderKind): IProvider {
  const p = providers.get(kind)
  if (!p) throw new Error(`no provider registered for kind '${kind}'`)
  return p
}

export function hasProvider(kind: ProviderKind): boolean {
  return providers.has(kind)
}

export function listRegistered(): readonly ProviderKind[] {
  return [...providers.keys()]
}

// Test-only — clears the registry. Don't call this in production code.
export function unregisterAll(): void {
  providers.clear()
}
