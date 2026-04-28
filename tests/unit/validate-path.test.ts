import { describe, it, expect } from 'vitest'
import { validateProjectPath, validateClaudeArg } from '../../src/main/transports/validate-path'

describe('validateProjectPath', () => {
  it('accepts a normal absolute path', () => {
    expect(() => validateProjectPath('/home/me/projects/foo')).not.toThrow()
  })

  it('accepts paths with spaces, dots, and unicode', () => {
    expect(() => validateProjectPath('/home/me/My Project · α/β')).not.toThrow()
  })

  it('rejects an empty string', () => {
    expect(() => validateProjectPath('')).toThrow(/non-empty string/)
  })

  it('rejects a NUL byte', () => {
    expect(() => validateProjectPath('/home/me\x00/foo')).toThrow(/control characters/)
  })

  it('rejects a newline (would split sh -c command lists)', () => {
    expect(() => validateProjectPath('/foo\nbar')).toThrow(/control characters/)
  })

  it('rejects ESC and DEL', () => {
    expect(() => validateProjectPath('/foo\x1b/bar')).toThrow(/control characters/)
    expect(() => validateProjectPath('/foo\x7f')).toThrow(/control characters/)
  })

  // The original C1 vector — a malicious projects.json with $(...) shell
  // expansion on the path. shQuote in ssh.ts neutralises this, but the
  // validator here adds defense-in-depth: a path with control chars (which
  // shQuote can't neutralise inside a sh -c parse) gets rejected up front.
  it('still accepts paths containing $ and backticks (those are inert under shQuote)', () => {
    expect(() => validateProjectPath('/home/me/$(weird)')).not.toThrow()
    expect(() => validateProjectPath('/home/me/`backtick`')).not.toThrow()
  })
})

describe('validateClaudeArg', () => {
  it('accepts a normal model id', () => {
    expect(() => validateClaudeArg('claude-opus-4-7', 'model')).not.toThrow()
  })

  it('rejects newline and NUL byte', () => {
    expect(() => validateClaudeArg('a\nb', 'model')).toThrow(/control characters/)
    expect(() => validateClaudeArg('a\x00b', 'resumeSessionId')).toThrow(/control characters/)
  })

  it('reports the supplied label in the error message', () => {
    expect(() => validateClaudeArg('a\nb', 'resumeSessionId')).toThrow(/resumeSessionId/)
  })
})
