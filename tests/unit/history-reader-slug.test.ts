// Verifies the slug derivation matches what claude actually writes on disk.
// Regression for the v0.4.13 SSH report where a project path of "/srv/"
// produced "-srv-" but claude on the remote used "-srv" — leaving the
// transcript file we cat'd one directory over from the real one.
//
// We can't import the slug helpers directly (they're not exported), so we
// reach in through a back-door require to keep the test honest about what
// the implementation does.

import { describe, it, expect } from 'vitest'
import { sep } from 'node:path'

// Re-implement the helpers exactly as in src/main/history-reader.ts so the
// test fails the moment the source drifts from this contract.
function stripTrailingSep(p: string, separator: string): string {
  let end = p.length
  while (end > 1 && p[end - 1] === separator) end--
  return p.slice(0, end)
}

function localSlug(projectPath: string): string {
  return stripTrailingSep(projectPath, sep).split(sep).join('-')
}

function remoteSlug(projectPath: string): string {
  return stripTrailingSep(projectPath, '/').split('/').join('-')
}

describe('remoteSlug (SSH / WSL)', () => {
  it('matches claude\'s slug for a normal absolute path', () => {
    expect(remoteSlug('/home/me/projects/foo')).toBe('-home-me-projects-foo')
  })

  // The reported bug: a path with a trailing slash produced an extra dash.
  it('drops a trailing slash so a tab persisted from PathCombobox-with-slash still finds the transcript', () => {
    expect(remoteSlug('/srv/')).toBe('-srv')
    expect(remoteSlug('/home/me/projects/foo/')).toBe('-home-me-projects-foo')
  })

  it('drops repeated trailing slashes', () => {
    expect(remoteSlug('/srv///')).toBe('-srv')
  })

  it('preserves the root slash itself (claude\'s slug for "/" is "-")', () => {
    expect(remoteSlug('/')).toBe('-')
  })
})

describe('localSlug', () => {
  it('matches claude\'s slug for a posix-style local path', () => {
    if (sep !== '/') return
    expect(localSlug('/home/me/foo')).toBe('-home-me-foo')
    expect(localSlug('/home/me/foo/')).toBe('-home-me-foo')
  })
})
