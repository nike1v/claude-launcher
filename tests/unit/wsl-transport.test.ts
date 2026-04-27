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

describe('WslTransport', () => {
  let spawnMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    const cp = await import('node:child_process')
    spawnMock = vi.mocked(cp.spawn)
    spawnMock.mockClear()
  })

  it('spawns wsl.exe with claude directly when no PATH is cached', () => {
    const transport = new WslTransport()
    transport.spawn({
      host: {kind: 'wsl', distro: 'NoCachePath'},
      path: '/home/user/project',
      model: undefined,
      resumeSessionId: undefined
    })

    expect(spawnMock).toHaveBeenCalledWith(
      'wsl.exe',
      [
        '-d', 'NoCachePath',
        '--cd', '/home/user/project',
        '--',
        'claude',
        '--output-format', 'stream-json',
        '--input-format', 'stream-json',
        '--verbose',
        '--permission-prompt-tool', 'stdio'
      ],
      expect.objectContaining({stdio: ['pipe', 'pipe', 'pipe']})
    )
  })

  it('prefixes claude with `env PATH=...` when a probe cached the user PATH', () => {
    const host = {kind: 'wsl' as const, distro: 'WithPath'}
    setCachedPath(host, '/home/user/.local/bin:/usr/bin')
    const transport = new WslTransport()
    transport.spawn({
      host,
      path: '/tmp',
      model: undefined,
      resumeSessionId: undefined
    })

    const args: string[] = spawnMock.mock.calls[0][1]
    // env + PATH=... must come before claude so claude sees the user PATH.
    const envIdx = args.indexOf('env')
    const claudeIdx = args.indexOf('claude')
    expect(envIdx).toBeGreaterThan(-1)
    expect(envIdx).toBeLessThan(claudeIdx)
    expect(args[envIdx + 1]).toBe('PATH=/home/user/.local/bin:/usr/bin')
  })

  it('appends --model flag when model is specified', () => {
    const transport = new WslTransport()
    transport.spawn({
      host: {kind: 'wsl', distro: 'ModelDistro'},
      path: '/tmp',
      model: 'claude-opus-4-7',
      resumeSessionId: undefined
    })

    const args: string[] = spawnMock.mock.calls[0][1]
    expect(args).toContain('--model')
    expect(args).toContain('claude-opus-4-7')
  })

  it('appends --resume flag when resumeSessionId is provided', () => {
    const transport = new WslTransport()
    transport.spawn({
      host: {kind: 'wsl', distro: 'ResumeDistro'},
      path: '/tmp',
      model: undefined,
      resumeSessionId: 'sess-abc'
    })

    const args: string[] = spawnMock.mock.calls[0][1]
    expect(args).toContain('--resume')
    expect(args).toContain('sess-abc')
  })

  it('does not inject CLAUDE_CODE_OAUTH_TOKEN', () => {
    const transport = new WslTransport()
    transport.spawn({
      host: {kind: 'wsl', distro: 'EnvDistro'},
      path: '/tmp',
      model: undefined,
      resumeSessionId: undefined
    })

    const spawnEnv = spawnMock.mock.calls[0][2]?.env
    expect(spawnEnv?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })
})
