import { describe, it, expect } from 'vitest'
import { migrateProjectsToEnvironments } from '../../src/main/environment-store'
import type { Environment } from '../../src/shared/types'

// One-shot migration touching every install upgrading from v0.3.x. Easy to
// get wrong; impossible to undo from the user's side. These tests pin the
// behaviour against accidental drift.

describe('migrateProjectsToEnvironments', () => {
  it('lifts a single legacy project into a new environment', () => {
    const result = migrateProjectsToEnvironments(
      [
        {
          id: 'p1',
          name: 'My App',
          path: '/srv/app',
          host: { kind: 'ssh', user: 'me', host: 'box', port: 22 }
        }
      ],
      []
    )

    expect(result.changed).toBe(true)
    expect(result.environments).toHaveLength(1)
    expect(result.environments[0].config).toEqual({
      kind: 'ssh', user: 'me', host: 'box', port: 22
    })
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].environmentId).toBe(result.environments[0].id)
    expect(result.projects[0]).not.toHaveProperty('host')
  })

  it('dedupes hosts across multiple legacy projects (same user@host → one env)', () => {
    const result = migrateProjectsToEnvironments(
      [
        { id: 'p1', name: 'A', path: '/srv/a', host: { kind: 'ssh', user: 'me', host: 'box' } },
        { id: 'p2', name: 'B', path: '/srv/b', host: { kind: 'ssh', user: 'me', host: 'box' } }
      ],
      []
    )
    expect(result.environments).toHaveLength(1)
    expect(result.projects[0].environmentId).toBe(result.projects[1].environmentId)
  })

  // Regression for the v0.4.7 audit finding: the old `sameHost` checked
  // ports while the UI's dedup ignored them, so an install with `port: 22`
  // explicit could have ended up with a duplicate env. After v0.4.8 they
  // share a comparator — these two should map to the same environment.
  it('dedupes SSH hosts even when one entry has port: 22 and the other omits it', () => {
    const result = migrateProjectsToEnvironments(
      [
        { id: 'p1', name: 'A', path: '/x', host: { kind: 'ssh', user: 'me', host: 'box' } },
        { id: 'p2', name: 'B', path: '/y', host: { kind: 'ssh', user: 'me', host: 'box', port: 22 } }
      ],
      []
    )
    expect(result.environments).toHaveLength(1)
  })

  it('treats projects already on the new shape (with environmentId) as no-ops', () => {
    const existing: Environment[] = [
      { id: 'env-1', name: 'Local', config: { kind: 'local' } }
    ]
    const result = migrateProjectsToEnvironments(
      [{ id: 'p1', name: 'Done', path: '/x', environmentId: 'env-1' }],
      existing
    )
    expect(result.changed).toBe(false)
    expect(result.environments).toEqual(existing)
    expect(result.projects).toEqual([
      { id: 'p1', name: 'Done', path: '/x', environmentId: 'env-1' }
    ])
  })

  it('reuses an existing environment when a legacy project matches its host', () => {
    const existing: Environment[] = [
      { id: 'env-existing', name: 'My Box', config: { kind: 'ssh', user: 'me', host: 'box' } }
    ]
    const result = migrateProjectsToEnvironments(
      [{ id: 'p1', name: 'A', path: '/x', host: { kind: 'ssh', user: 'me', host: 'box' } }],
      existing
    )
    expect(result.environments).toHaveLength(1)
    expect(result.projects[0].environmentId).toBe('env-existing')
  })

  it('skips projects with malformed payloads (null, missing fields)', () => {
    const result = migrateProjectsToEnvironments(
      [
        null,
        'string-instead-of-object',
        { id: 'p1' /* missing name/path/host */ },
        { name: 'no-id', path: '/x', host: { kind: 'local' } }
      ] as unknown[],
      []
    )
    expect(result.changed).toBe(false)
    expect(result.projects).toEqual([])
    expect(result.environments).toEqual([])
  })

  // Defence-in-depth from v0.4.8: a tampered projects.json with a leading-
  // dash hostname (would be parsed as ssh argv flag) gets dropped instead
  // of silently rewriting the bogus host into environments.json.
  it('skips projects whose host fails the live validators', () => {
    const result = migrateProjectsToEnvironments(
      [
        {
          id: 'p1',
          name: 'malicious',
          path: '/x',
          host: { kind: 'ssh', host: '-oProxyCommand=evil' }
        }
      ],
      []
    )
    expect(result.changed).toBe(false)
    expect(result.environments).toEqual([])
    expect(result.projects).toEqual([])
  })

  it('preserves the project model field through migration', () => {
    const result = migrateProjectsToEnvironments(
      [
        {
          id: 'p1',
          name: 'A',
          path: '/x',
          model: 'claude-opus-4-7',
          host: { kind: 'local' }
        }
      ],
      []
    )
    expect(result.projects[0].model).toBe('claude-opus-4-7')
  })
})
