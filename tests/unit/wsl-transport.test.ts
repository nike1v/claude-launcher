import {describe, it, expect, vi, beforeEach} from 'vitest'
import {WslTransport} from '../../src/main/transports/wsl'
import {setCachedPath} from '../../src/main/transports/path-cache'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 1234,
    stdin: {write: vi.fn(), end: vi.fn()},
    stdout: {on: vi.fn()},
    stderr: {on: vi.fn()},
    on: vi.fn()
  }))
}))

// Argv that ClaudeProvider.buildSpawnArgs would produce for a vanilla call.
// Hardcoded here so transport tests don't depend on the provider — they
// only verify the wsl.exe wrapping.
const CLAUDE_ARGS = [
  '--output-format', 'stream-json',
  '--input-format', 'stream-json',
  '--verbose',
  '--permission-prompt-tool', 'stdio'
] as const

describe('WslTransport', () => {
  let spawnMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    const cp = await import('node:child_process')
    spawnMock = vi.mocked(cp.spawn)
    spawnMock.mockClear()
  })

  it('wraps the binary in a bash -c PATH-prepend script (no probe cache)', () => {
    const transport = new WslTransport()
    transport.spawn({
      host: {kind: 'wsl', distro: 'NoCachePath'},
      path: '/home/user/project',
      bin: 'claude',
      args: CLAUDE_ARGS
    })

    const callArgs: string[] = spawnMock.mock.calls[0][1]
    // wsl.exe args layout: -d <distro> --cd <path> -- bash -c <script> -- <bin> <bin-args>
    expect(callArgs.slice(0, 7)).toEqual([
      '-d', 'NoCachePath',
      '--cd', '/home/user/project',
      '--',
      'bash', '-c'
    ])
    // Without a cached path we fall through to $PATH so the spawned shell
    // still picks up whatever wsl.exe inherited.
    const script = callArgs[7]
    expect(script).toContain('$HOME/.opencode/bin')
    expect(script).toContain('$HOME/.local/bin')
    expect(script).toContain(':$PATH"')
    expect(script).toContain('exec "$@"')
    // Positional argv after the `--`: $0 placeholder, then bin, then args.
    expect(callArgs.slice(8)).toEqual(['--', 'claude', ...CLAUDE_ARGS])
  })

  it('embeds the cached PATH into the bash -c script when a probe ran first', () => {
    const host = {kind: 'wsl' as const, distro: 'WithPath'}
    setCachedPath(host, '/home/user/.local/bin:/usr/bin')
    const transport = new WslTransport()
    transport.spawn({
      host,
      path: '/tmp',
      bin: 'claude',
      args: CLAUDE_ARGS
    })

    const args: string[] = spawnMock.mock.calls[0][1]
    const scriptIdx = args.indexOf('-c') + 1
    const script = args[scriptIdx]
    expect(script).toContain(':/home/user/.local/bin:/usr/bin"')
    expect(script).toContain('$HOME/.opencode/bin')
  })

  it('passes provider-built argv straight through after the binary', () => {
    const transport = new WslTransport()
    transport.spawn({
      host: {kind: 'wsl', distro: 'ModelDistro'},
      path: '/tmp',
      bin: 'claude',
      args: [...CLAUDE_ARGS, '--model', 'claude-opus-4-7']
    })

    const args: string[] = spawnMock.mock.calls[0][1]
    expect(args).toContain('--model')
    expect(args).toContain('claude-opus-4-7')
  })

  it('scrubs env vars matching the provided patterns', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'leak-me-not'
    process.env.UNRELATED_VAR = 'keep-me'
    const transport = new WslTransport()
    transport.spawn({
      host: {kind: 'wsl', distro: 'EnvDistro'},
      path: '/tmp',
      bin: 'claude',
      args: CLAUDE_ARGS,
      envScrubKeys: [{ prefix: 'CLAUDE_CODE_' }]
    })

    const spawnEnv = spawnMock.mock.calls[0][2]?.env
    expect(spawnEnv?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(spawnEnv?.UNRELATED_VAR).toBe('keep-me')

    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.UNRELATED_VAR
  })
})
