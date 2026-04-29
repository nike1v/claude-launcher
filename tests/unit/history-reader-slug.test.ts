// Verifies the slug derivation matches what claude actually writes on disk.
// Regression for the v0.4.13 SSH report where a project path of "/srv/"
// produced "-srv-" but claude on the remote used "-srv" — leaving the
// transcript file we cat'd one directory over from the real one.

import { describe, it, expect } from 'vitest'
import { claudeProjectSlug } from '../../src/shared/host-utils'

describe('claudeProjectSlug', () => {
  it('matches claude\'s slug for a normal absolute path', () => {
    expect(claudeProjectSlug('/home/me/projects/foo')).toBe('-home-me-projects-foo')
  })

  // The original v0.4.13 SSH bug: a path with a trailing slash produced an
  // extra dash so we cat'd the wrong transcript directory.
  it('drops a trailing slash so a tab persisted from PathCombobox-with-slash still finds the transcript', () => {
    expect(claudeProjectSlug('/srv/')).toBe('-srv')
    expect(claudeProjectSlug('/home/me/projects/foo/')).toBe('-home-me-projects-foo')
  })

  it('drops repeated trailing slashes', () => {
    expect(claudeProjectSlug('/srv///')).toBe('-srv')
  })

  it('preserves the root slash itself (claude\'s slug for "/" is "-")', () => {
    expect(claudeProjectSlug('/')).toBe('-')
  })

  it('handles backslash-separated paths (Windows-style local)', () => {
    expect(claudeProjectSlug('C:\\Users\\me\\foo')).toBe('C:-Users-me-foo')
    expect(claudeProjectSlug('C:\\Users\\me\\foo\\')).toBe('C:-Users-me-foo')
  })
})
