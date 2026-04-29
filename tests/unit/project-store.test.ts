import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectStore } from '../../src/main/project-store'
import type { Project } from '../../src/shared/types'

// Matches the v0.4+ Project shape (environmentId, not the legacy host
// field). Before validate-persisted.ts the store cast loaded JSON
// directly, so the old fixture limped along — now the loader actually
// checks every field, so the fixture has to be valid.
const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'proj-1',
  name: 'Test Project',
  environmentId: 'env-1',
  path: '/home/user/myproject',
  ...overrides
})

describe('ProjectStore', () => {
  let tmpDir: string
  let store: ProjectStore

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'claude-launcher-test-'))
    store = new ProjectStore(join(tmpDir, 'projects.json'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true })
  })

  it('returns empty array when file does not exist', () => {
    expect(store.load()).toEqual([])
  })

  it('saves and loads projects', () => {
    const project = makeProject()
    store.save([project])
    expect(store.load()).toEqual([project])
  })

  it('overwrites on second save', () => {
    store.save([makeProject({ id: 'a' })])
    store.save([makeProject({ id: 'b' }), makeProject({ id: 'c' })])
    const loaded = store.load()
    expect(loaded).toHaveLength(2)
    expect(loaded.map(p => p.id)).toEqual(['b', 'c'])
  })

  it('returns empty array if file contains invalid JSON', () => {
    const { writeFileSync } = require('node:fs')
    writeFileSync(join(tmpDir, 'projects.json'), 'not json', 'utf-8')
    expect(store.load()).toEqual([])
  })
})
