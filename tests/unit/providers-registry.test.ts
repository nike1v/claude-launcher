import { describe, it, expect, beforeEach } from 'vitest'
import {
  register,
  getProvider,
  hasProvider,
  listRegistered,
  unregisterAll
} from '../../src/main/providers/registry'
import type { IProvider } from '../../src/main/providers/types'
import type { ProviderKind } from '../../src/shared/events'

// Bare-minimum stand-in so the registry contract is testable without a
// real provider implementation.
function makeStubProvider(kind: ProviderKind): IProvider {
  return {
    kind,
    label: `${kind} (stub)`,
    capabilities: {
      resume: 'none',
      permissions: 'none',
      usage: 'none',
      sessionModelSwitch: 'unsupported',
      transcripts: 'none'
    },
    buildSpawnArgs: () => ({ bin: 'true', args: [] }),
    formatUserMessage: () => '',
    formatControl: () => null,
    envScrubList: () => []
  }
}

beforeEach(() => {
  unregisterAll()
})

describe('provider registry', () => {
  it('registers and resolves a provider', () => {
    register(makeStubProvider('claude'))

    expect(hasProvider('claude')).toBe(true)
    expect(getProvider('claude').kind).toBe('claude')
  })

  it('throws when resolving an unregistered provider', () => {
    expect(() => getProvider('codex')).toThrow(/no provider registered/)
  })

  it('lists every registered kind', () => {
    register(makeStubProvider('claude'))
    register(makeStubProvider('codex'))

    expect([...listRegistered()].sort()).toEqual(['claude', 'codex'])
  })

  it('overwrites a prior registration for the same kind', () => {
    const first = makeStubProvider('claude')
    const second = makeStubProvider('claude')
    register(first)
    register(second)

    expect(getProvider('claude')).toBe(second)
  })

  it('unregisterAll() leaves the registry empty', () => {
    register(makeStubProvider('claude'))
    unregisterAll()

    expect(hasProvider('claude')).toBe(false)
    expect(listRegistered()).toEqual([])
  })
})
