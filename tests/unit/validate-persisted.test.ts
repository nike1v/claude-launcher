import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  validateProject,
  validateEnvironment,
  validatePersistedTab,
  validatePersistedTabs
} from '../../src/main/validate-persisted'

// Quiet the console.warns the loaders emit while we feed them garbage.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('validateProject', () => {
  it('accepts a minimal valid project', () => {
    expect(() =>
      validateProject({ id: 'p1', name: 'My App', environmentId: 'env-1', path: '/srv' })
    ).not.toThrow()
  })

  it('accepts the full project shape', () => {
    expect(() =>
      validateProject({
        id: 'p1', name: 'A', environmentId: 'env-1', path: '/srv',
        model: 'claude-opus-4-7',
        lastSessionRef: 'abc-123',
        lastModel: 'claude-opus-4-7',
        lastContextWindow: 200_000
      })
    ).not.toThrow()
  })

  it('migrates legacy lastClaudeSessionId on read (v0.4 → 0.5)', () => {
    const raw: Record<string, unknown> = {
      id: 'p1', name: 'A', environmentId: 'env-1', path: '/srv',
      lastClaudeSessionId: 'abc-123'
    }
    expect(() => validateProject(raw)).not.toThrow()
    expect(raw.lastSessionRef).toBe('abc-123')
    expect(raw.lastClaudeSessionId).toBeUndefined()
  })

  it('rejects null / non-object inputs', () => {
    expect(() => validateProject(null)).toThrow(/must be an object/)
    expect(() => validateProject('string')).toThrow(/must be an object/)
    expect(() => validateProject([])).toThrow(/must be an object/)
  })

  it('rejects an empty id', () => {
    expect(() => validateProject({ id: '', name: 'a', environmentId: 'e', path: '/x' }))
      .toThrow(/Project\.id/)
  })

  it('rejects a missing environmentId', () => {
    expect(() => validateProject({ id: 'p1', name: 'a', path: '/x' }))
      .toThrow(/Project\.environmentId/)
  })

  it('rejects a non-string optional field', () => {
    expect(() => validateProject({
      id: 'p1', name: 'a', environmentId: 'e', path: '/x',
      lastModel: 42
    })).toThrow(/Project\.lastModel/)
  })

  it('rejects a non-finite lastContextWindow (NaN slips through typeof number)', () => {
    expect(() => validateProject({
      id: 'p1', name: 'a', environmentId: 'e', path: '/x',
      lastContextWindow: NaN
    })).toThrow(/Project\.lastContextWindow/)
  })

  it('accepts a known providerKind', () => {
    expect(() => validateProject({
      id: 'p1', name: 'a', environmentId: 'e', path: '/x',
      providerKind: 'codex'
    })).not.toThrow()
  })

  it('rejects an unknown providerKind', () => {
    expect(() => validateProject({
      id: 'p1', name: 'a', environmentId: 'e', path: '/x',
      providerKind: 'aider'
    })).toThrow(/Project\.providerKind/)
  })
})

describe('validateEnvironment', () => {
  it('accepts a local env', () => {
    expect(() =>
      validateEnvironment({ id: 'e1', name: 'Local', config: { kind: 'local' } })
    ).not.toThrow()
  })

  it('accepts a wsl env', () => {
    expect(() =>
      validateEnvironment({ id: 'e1', name: 'WSL', config: { kind: 'wsl', distro: 'Ubuntu' } })
    ).not.toThrow()
  })

  it('accepts an ssh env with all fields', () => {
    expect(() =>
      validateEnvironment({
        id: 'e1', name: 'Hetzner',
        config: { kind: 'ssh', user: 'me', host: 'box', port: 22, keyFile: '/k.pem' },
        defaultModel: 'claude-opus-4-7'
      })
    ).not.toThrow()
  })

  it('rejects a wsl env with missing distro', () => {
    expect(() =>
      validateEnvironment({ id: 'e1', name: 'X', config: { kind: 'wsl' } })
    ).toThrow(/config\.distro/)
  })

  it('rejects an ssh env with missing host', () => {
    expect(() =>
      validateEnvironment({ id: 'e1', name: 'X', config: { kind: 'ssh' } })
    ).toThrow(/config\.host/)
  })

  it('rejects an ssh env with out-of-range port', () => {
    expect(() =>
      validateEnvironment({ id: 'e1', name: 'X', config: { kind: 'ssh', host: 'box', port: 99999 } })
    ).toThrow(/config\.port/)
    expect(() =>
      validateEnvironment({ id: 'e1', name: 'X', config: { kind: 'ssh', host: 'box', port: 0 } })
    ).toThrow(/config\.port/)
  })

  it('rejects an unknown config.kind', () => {
    expect(() =>
      validateEnvironment({ id: 'e1', name: 'X', config: { kind: 'docker' } })
    ).toThrow(/config\.kind/)
  })

  it('accepts a known providerKind', () => {
    expect(() =>
      validateEnvironment({
        id: 'e1', name: 'X', config: { kind: 'local' },
        providerKind: 'opencode'
      })
    ).not.toThrow()
  })

  it('rejects an unknown providerKind', () => {
    expect(() =>
      validateEnvironment({
        id: 'e1', name: 'X', config: { kind: 'local' },
        providerKind: 'gemini'
      })
    ).toThrow(/Environment\.providerKind/)
  })
})

describe('validatePersistedTab', () => {
  it('accepts a minimal valid tab', () => {
    expect(() =>
      validatePersistedTab({ projectId: 'p1', sessionRef: 'abc-123' })
    ).not.toThrow()
  })

  it('rejects an empty sessionRef', () => {
    expect(() =>
      validatePersistedTab({ projectId: 'p1', sessionRef: '' })
    ).toThrow(/PersistedTab\.sessionRef/)
  })
})

describe('validatePersistedTabs', () => {
  it('returns the snapshot when every entry is valid', () => {
    const result = validatePersistedTabs({
      tabs: [
        { projectId: 'p1', sessionRef: 'a' },
        { projectId: 'p2', sessionRef: 'b' }
      ],
      activeIndex: 1
    })
    expect(result.tabs).toHaveLength(2)
    expect(result.activeIndex).toBe(1)
  })

  it('drops malformed tab entries but keeps valid ones', () => {
    const result = validatePersistedTabs({
      tabs: [
        { projectId: 'p1', sessionRef: 'a' },
        { projectId: 'p2' },                     // missing sessionRef
        null,                                    // not an object
        { projectId: 'p3', sessionRef: 'c' }
      ],
      activeIndex: 0
    })
    expect(result.tabs).toHaveLength(2)
    expect(result.tabs[0].projectId).toBe('p1')
    expect(result.tabs[1].projectId).toBe('p3')
  })

  it('clamps an out-of-range activeIndex back to null', () => {
    const result = validatePersistedTabs({
      tabs: [{ projectId: 'p1', sessionRef: 'a' }],
      activeIndex: 5
    })
    expect(result.activeIndex).toBeNull()
  })

  it('treats a non-array tabs field as a fatal corruption', () => {
    expect(() => validatePersistedTabs({ tabs: 'not an array', activeIndex: null }))
      .toThrow(/PersistedTabs\.tabs/)
  })
})
