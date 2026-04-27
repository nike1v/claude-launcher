import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { HostType } from '../../shared/types'
import type { ITransport, ProbeResult, SpawnOptions } from './types'
import { runProbe } from './probe'
import { loginShellArgs } from './shell'

export class WslTransport implements ITransport {
  public spawn(options: SpawnOptions): ChildProcess {
    const { host, path, model, resumeSessionId } = options
    if (host.kind !== 'wsl') throw new Error('WslTransport requires wsl host')

    const claudeArgs = [
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--permission-prompt-tool', 'stdio'
    ]
    if (model) claudeArgs.push('--model', model)
    if (resumeSessionId) claudeArgs.push('--resume', resumeSessionId)

    // wsl.exe's default shell is non-login non-interactive — it ignores
    // ~/.profile and so misses anything the user added there. Wrap the
    // claude invocation in `bash -lc 'claude "$@"' bash …args` so a login
    // shell sets up PATH (≈/.local/bin, asdf, etc.) before we exec.
    return spawn(
      'wsl.exe',
      ['-d', host.distro, '--cd', path, '--', 'bash', ...loginShellArgs('claude "$@"', claudeArgs)],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => !key.startsWith('CLAUDE_CODE_') && key !== 'CLAUDE_RPC_TOKEN'
          )
        )
      }
    )
  }

  public probe(host: HostType): Promise<ProbeResult> {
    if (host.kind !== 'wsl') {
      return Promise.resolve({ ok: false, reason: 'WslTransport requires wsl host' })
    }
    return runProbe({
      bin: 'wsl.exe',
      args: ['-d', host.distro, '--', 'bash', '-lc', 'claude --version'],
      // wsl.exe cold start + login shell sourcing can both be slow.
      timeoutMs: 15_000
    })
  }
}
