import { describe, it, expect } from 'vitest'
import { validateSshHost, validateWslDistro } from '../../src/main/transports/validate-ssh'

describe('validateSshHost', () => {
  it('accepts a normal hostname', () => {
    expect(() => validateSshHost({ kind: 'ssh', host: 'example.com' })).not.toThrow()
  })

  it('accepts user@host with a normal user', () => {
    expect(() => validateSshHost({ kind: 'ssh', user: 'alice', host: 'example.com' })).not.toThrow()
  })

  it('accepts a Host alias from ssh_config (with no user)', () => {
    expect(() => validateSshHost({ kind: 'ssh', host: 'my-prod-server' })).not.toThrow()
  })

  it('rejects a host that starts with a dash (argv injection as ssh option)', () => {
    expect(() =>
      validateSshHost({ kind: 'ssh', host: '-oProxyCommand=evil' })
    ).toThrow(/Invalid SSH host/)
  })

  it('rejects a host that contains whitespace', () => {
    expect(() =>
      validateSshHost({ kind: 'ssh', host: 'real.com -oProxyCommand=evil' })
    ).toThrow(/Invalid SSH host/)
  })

  it('rejects a user that starts with a dash', () => {
    expect(() =>
      validateSshHost({ kind: 'ssh', user: '-oUser=root', host: 'example.com' })
    ).toThrow(/Invalid SSH user/)
  })

  it('rejects a user with whitespace', () => {
    expect(() =>
      validateSshHost({ kind: 'ssh', user: 'al ice', host: 'example.com' })
    ).toThrow(/Invalid SSH user/)
  })

  it('rejects an out-of-range port', () => {
    expect(() =>
      validateSshHost({ kind: 'ssh', host: 'example.com', port: 99999 })
    ).toThrow(/Invalid SSH port/)
    expect(() =>
      validateSshHost({ kind: 'ssh', host: 'example.com', port: 0 })
    ).toThrow(/Invalid SSH port/)
  })

  it('rejects a key file path with control characters', () => {
    expect(() =>
      validateSshHost({ kind: 'ssh', host: 'example.com', keyFile: '/tmp/key\nevil' })
    ).toThrow(/Invalid SSH key file/)
  })
})

describe('validateWslDistro', () => {
  it('accepts a normal distro name', () => {
    expect(() => validateWslDistro('Ubuntu')).not.toThrow()
    expect(() => validateWslDistro('Ubuntu-22.04')).not.toThrow()
  })

  it('rejects an empty distro', () => {
    expect(() => validateWslDistro('')).toThrow(/Invalid WSL distro/)
  })

  it('rejects a distro that starts with a dash (would be parsed as wsl.exe flag)', () => {
    expect(() => validateWslDistro('-shutdown')).toThrow(/Invalid WSL distro/)
  })

  it('rejects a distro with whitespace', () => {
    expect(() => validateWslDistro('Ubuntu evil')).toThrow(/Invalid WSL distro/)
  })
})
