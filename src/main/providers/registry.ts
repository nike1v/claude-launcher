// Provider/Adapter registry. PR 1 ships the empty registry + tests; PR 2
// wires `register('claude', new ClaudeProvider(), new ClaudeAdapter())` at
// startup.
//
// Module-level Map state — there's one provider/adapter per ProviderKind
// for the whole process. Tests use `unregisterAll()` to reset between
// runs. session-manager calls `getProvider(kind)` / `getAdapter(kind)`
// when starting a session.

import type { ProviderKind } from '../../shared/events'
import type { IProvider, IProviderAdapter } from './types'

const providers = new Map<ProviderKind, IProvider>()
const adapters = new Map<ProviderKind, IProviderAdapter>()

export function register(provider: IProvider, adapter: IProviderAdapter): void {
  if (provider.kind !== adapter.kind) {
    throw new Error(
      `provider/adapter kind mismatch: provider=${provider.kind}, adapter=${adapter.kind}`
    )
  }
  providers.set(provider.kind, provider)
  adapters.set(adapter.kind, adapter)
}

export function getProvider(kind: ProviderKind): IProvider {
  const p = providers.get(kind)
  if (!p) throw new Error(`no provider registered for kind '${kind}'`)
  return p
}

export function getAdapter(kind: ProviderKind): IProviderAdapter {
  const a = adapters.get(kind)
  if (!a) throw new Error(`no adapter registered for kind '${kind}'`)
  return a
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
  adapters.clear()
}
