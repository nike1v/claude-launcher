import {describe, it, expect, vi, beforeEach} from 'vitest'
import {WslTransport} from '../../src/main/transports/wsl'

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

  it('spawns wsl.exe with correct args', () => {
    const transport = new WslTransport()
    transport.spawn({
      host: {kind: 'wsl', distro: 'Ubuntu'},
      path: '/home/user/project',
      model: undefined,
      resumeSessionId: undefined
    })

    expect(spawnMock).toHaveBeenCalledWith(
      'wsl.exe',
      [
        '-d', 'Ubuntu',
        '--cd', '/home/user/project',
        '--',
        'claude',
        '--output-format', 'stream-json',
        '--input-format', 'stream-json',
        '--permission-prompt-tool', 'stdio'
      ],
      expect.objectContaining({stdio: ['pipe', 'pipe', 'pipe']})
    )
  })

  it('appends --model flag when model is specified', () => {
    const transport = new WslTransport()
    transport.spawn({
      host: {kind: 'wsl', distro: 'Ubuntu'},
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
      host: {kind: 'wsl', distro: 'Ubuntu'},
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
      host: {kind: 'wsl', distro: 'Ubuntu'},
      path: '/tmp',
      model: undefined,
      resumeSessionId: undefined
    })

    const spawnEnv = spawnMock.mock.calls[0][2]?.env
    expect(spawnEnv?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })
})
