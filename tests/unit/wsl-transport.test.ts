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

  it('spawns wsl.exe with the provider binary directly when no PATH is cached', () => {
    const transport = new WslTransport()
    transport.spawn({
      host: {kind: 'wsl', distro: 'NoCachePath'},
      path: '/home/user/project',
      bin: 'claude',
      args: CLAUDE_ARGS
    })

    expect(spawnMock).toHaveBeenCalledWith(
      'wsl.exe',
      [
        '-d', 'NoCachePath',
        '--cd', '/home/user/project',
        '--',
        'claude',
        ...CLAUDE_ARGS
      ],
      expect.objectContaining({stdio: ['pipe', 'pipe', 'pipe']})
    )
  })

  it('prefixes the binary with `env PATH=...` when a probe cached the user PATH', () => {
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
    // env + PATH=... must come before the binary so the child sees the user PATH.
    const envIdx = args.indexOf('env')
    const binIdx = args.indexOf('claude')
    expect(envIdx).toBeGreaterThan(-1)
    expect(envIdx).toBeLessThan(binIdx)
    expect(args[envIdx + 1]).toBe('PATH=/home/user/.local/bin:/usr/bin')
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
      envScrubKeys: ['CLAUDE_CODE_*']
    })

    const spawnEnv = spawnMock.mock.calls[0][2]?.env
    expect(spawnEnv?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(spawnEnv?.UNRELATED_VAR).toBe('keep-me')

    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.UNRELATED_VAR
  })
})
