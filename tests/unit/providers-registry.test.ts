import { describe, it, expect, beforeEach } from 'vitest'
import {
  register,
  getProvider,
  getAdapter,
  hasProvider,
  listRegistered,
  unregisterAll
} from '../../src/main/providers/registry'
import type { IProvider, IProviderAdapter, ProbeResult } from '../../src/main/providers/types'
import type { NormalizedEvent, ProviderKind } from '../../src/shared/events'

// Bare-minimum stand-ins so the registry contract is testable without
// pulling in a real provider implementation. PR 2 replaces these with the
// actual ClaudeProvider / ClaudeAdapter.
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
    probeBinary: async (): Promise<ProbeResult> => ({ ok: false, reason: 'stub' }),
    buildSpawnArgs: () => ({ bin: 'true', args: [] }),
    formatUserMessage: () => '',
    formatControl: () => null,
    transcriptDir: () => null,
    envScrubList: () => []
  }
}

function makeStubAdapter(kind: ProviderKind): IProviderAdapter {
  return {
    kind,
    parseChunk: (): NormalizedEvent[] => [],
    parseTranscript: (): NormalizedEvent[] => []
  }
}

beforeEach(() => {
  unregisterAll()
})

describe('provider registry', () => {
  it('registers and resolves a matching provider/adapter pair', () => {
    register(makeStubProvider('claude'), makeStubAdapter('claude'))

    expect(hasProvider('claude')).toBe(true)
    expect(getProvider('claude').kind).toBe('claude')
    expect(getAdapter('claude').kind).toBe('claude')
  })

  it('rejects mismatched provider/adapter kinds at registration', () => {
    expect(() =>
      register(makeStubProvider('claude'), makeStubAdapter('codex'))
    ).toThrow(/kind mismatch/)
  })

  it('throws when resolving an unregistered provider', () => {
    expect(() => getProvider('codex')).toThrow(/no provider registered/)
    expect(() => getAdapter('codex')).toThrow(/no adapter registered/)
  })

  it('lists every registered kind', () => {
    register(makeStubProvider('claude'), makeStubAdapter('claude'))
    register(makeStubProvider('codex'), makeStubAdapter('codex'))

    expect([...listRegistered()].sort()).toEqual(['claude', 'codex'])
  })

  it('overwrites a prior registration for the same kind', () => {
    const first = makeStubProvider('claude')
    const second = makeStubProvider('claude')
    register(first, makeStubAdapter('claude'))
    register(second, makeStubAdapter('claude'))

    expect(getProvider('claude')).toBe(second)
  })

  it('unregisterAll() leaves the registry empty', () => {
    register(makeStubProvider('claude'), makeStubAdapter('claude'))
    unregisterAll()

    expect(hasProvider('claude')).toBe(false)
    expect(listRegistered()).toEqual([])
  })
})
