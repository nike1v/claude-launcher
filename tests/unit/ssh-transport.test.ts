import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SshTransport } from '../../src/main/transports/ssh'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 9999,
    stdin: { write: vi.fn(), end: vi.fn() },
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn()
  }))
}))

const CLAUDE_ARGS = [
  '--output-format', 'stream-json',
  '--input-format', 'stream-json',
  '--verbose',
  '--permission-prompt-tool', 'stdio'
] as const

describe('SshTransport.spawn — argv assembly', () => {
  let spawnMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    const cp = await import('node:child_process')
    spawnMock = vi.mocked(cp.spawn)
    spawnMock.mockClear()
  })

  it('builds args for a host alias with no user/port/key', () => {
    new SshTransport().spawn({
      host: { kind: 'ssh', host: 'prod' },
      path: '/srv/app',
      bin: 'claude',
      args: CLAUDE_ARGS
    })
    const args: string[] = spawnMock.mock.calls[0][1]
    expect(args[0]).toBe('-T')
    expect(args).toContain('prod')
    expect(args).not.toContain('-p')
    expect(args).not.toContain('-i')
  })

  it('inserts -p when port is set and -i when keyFile is set', () => {
    new SshTransport().spawn({
      host: { kind: 'ssh', user: 'me', host: 'box', port: 2222, keyFile: '/k.pem' },
      path: '/srv/app',
      bin: 'claude',
      args: CLAUDE_ARGS
    })
    const args: string[] = spawnMock.mock.calls[0][1]
    expect(args).toContain('-p')
    expect(args[args.indexOf('-p') + 1]).toBe('2222')
    expect(args).toContain('-i')
    expect(args[args.indexOf('-i') + 1]).toBe('/k.pem')
    expect(args).toContain('me@box')
  })

  // Regression for the v0.4.8 SSH RCE — the old spawn used JSON.stringify on
  // the path which kept $(...) live inside the remote sh's double quotes.
  // shQuote's single-quote wrap is inert, so a path of `$(reboot)` becomes
  // a literal directory name, not a remote shell expansion.
  it('single-quotes the project path so $(...) cannot expand on the remote', () => {
    new SshTransport().spawn({
      host: { kind: 'ssh', host: 'box' },
      path: '/srv/$(reboot)/app',
      bin: 'claude',
      args: CLAUDE_ARGS
    })
    const args: string[] = spawnMock.mock.calls[0][1]
    const remoteCmd = args[args.length - 1]
    // remoteCmd is the wrapping `sh -c '<innerScript>'`. The inner script
    // should embed the path single-quoted, not double-quoted.
    expect(remoteCmd).toContain("'/srv/$(reboot)/app'")
    expect(remoteCmd).not.toContain('"/srv/$(reboot)/app"')
  })

  it('rejects a host with a leading-dash (argv injection guard)', () => {
    const transport = new SshTransport()
    expect(() => transport.spawn({
      host: { kind: 'ssh', host: '-oProxyCommand=evil' },
      path: '/x',
      bin: 'claude',
      args: CLAUDE_ARGS
    })).toThrow(/Invalid SSH host/)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('rejects a path with a NUL byte (control-char guard)', () => {
    const transport = new SshTransport()
    expect(() => transport.spawn({
      host: { kind: 'ssh', host: 'box' },
      path: '/srv/\x00bad',
      bin: 'claude',
      args: CLAUDE_ARGS
    })).toThrow(/control characters/)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('strips env vars matching the provided scrub patterns', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'secret-from-host'
    try {
      new SshTransport().spawn({
        host: { kind: 'ssh', host: 'box' },
        path: '/x',
        bin: 'claude',
        args: CLAUDE_ARGS,
        envScrubKeys: ['CLAUDE_CODE_*']
      })
      const env = spawnMock.mock.calls[0][2]?.env
      expect(env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    } finally {
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    }
  })
})
