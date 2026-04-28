import { describe, it, expect } from 'vitest'
import { isSameHostTarget, describeHost, findDuplicateEnvironment } from '../../src/shared/host-utils'
import type { Environment, HostType } from '../../src/shared/types'

describe('isSameHostTarget', () => {
  it('two locals are equal', () => {
    expect(isSameHostTarget({ kind: 'local' }, { kind: 'local' })).toBe(true)
  })

  it('different kinds are never equal', () => {
    expect(isSameHostTarget({ kind: 'local' }, { kind: 'wsl', distro: 'Ubuntu' })).toBe(false)
  })

  it('WSL distros compare case-insensitively and ignore surrounding whitespace', () => {
    expect(isSameHostTarget(
      { kind: 'wsl', distro: ' Ubuntu ' },
      { kind: 'wsl', distro: 'ubuntu' }
    )).toBe(true)
  })

  // Regression for the v0.4.7 audit: the migration's `sameHost` treated SSH
  // hosts with different ports as different connections, while the UI's
  // dedup ignored the port (different ports against the same logical box are
  // the same machine). They now both go through this comparator.
  it('SSH hosts compare on (user, host) only — port is ignored', () => {
    expect(isSameHostTarget(
      { kind: 'ssh', user: 'me', host: 'box.example.com', port: 22 },
      { kind: 'ssh', user: 'me', host: 'box.example.com' }
    )).toBe(true)
    expect(isSameHostTarget(
      { kind: 'ssh', user: 'me', host: 'box.example.com', port: 22 },
      { kind: 'ssh', user: 'me', host: 'box.example.com', port: 2222 }
    )).toBe(true)
  })

  it('SSH user/host comparison is case-insensitive', () => {
    expect(isSameHostTarget(
      { kind: 'ssh', user: 'Alice', host: 'Box.Example.com' },
      { kind: 'ssh', user: 'alice', host: 'box.example.com' }
    )).toBe(true)
  })

  it('SSH with no user is distinct from SSH with a user (alias vs explicit)', () => {
    expect(isSameHostTarget(
      { kind: 'ssh', host: 'prod' },
      { kind: 'ssh', user: 'me', host: 'prod' }
    )).toBe(false)
  })
})

describe('describeHost', () => {
  it('returns "Local" for the local host', () => {
    expect(describeHost({ kind: 'local' })).toBe('Local')
  })

  it('returns "WSL · <distro>" for WSL', () => {
    expect(describeHost({ kind: 'wsl', distro: 'Ubuntu-22.04' })).toBe('WSL · Ubuntu-22.04')
  })

  it('returns "SSH · user@host" when user is set', () => {
    expect(describeHost({ kind: 'ssh', user: 'me', host: 'box.example.com' }))
      .toBe('SSH · me@box.example.com')
  })

  it('returns "SSH · host" when user is omitted (ssh_config alias)', () => {
    expect(describeHost({ kind: 'ssh', host: 'prod' })).toBe('SSH · prod')
  })

  it('appends ":port" when port is set', () => {
    expect(describeHost({ kind: 'ssh', user: 'me', host: 'box', port: 2222 }))
      .toBe('SSH · me@box:2222')
  })
})

describe('findDuplicateEnvironment', () => {
  const env = (id: string, config: HostType): Environment => ({ id, name: id, config })
  const envs = [
    env('a', { kind: 'local' }),
    env('b', { kind: 'wsl', distro: 'Ubuntu' }),
    env('c', { kind: 'ssh', user: 'me', host: 'box', port: 22 })
  ]

  it('returns the existing env when the new config matches', () => {
    expect(findDuplicateEnvironment(envs, { kind: 'local' })?.id).toBe('a')
    expect(findDuplicateEnvironment(envs, { kind: 'ssh', user: 'me', host: 'box' })?.id).toBe('c')
  })

  it('returns null when no env matches', () => {
    expect(findDuplicateEnvironment(envs, { kind: 'wsl', distro: 'Debian' })).toBeNull()
  })

  it('skips the excluded id (used when editing an existing env)', () => {
    expect(findDuplicateEnvironment(envs, { kind: 'local' }, 'a')).toBeNull()
  })
})
