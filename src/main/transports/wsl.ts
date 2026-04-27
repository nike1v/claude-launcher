import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { HostType } from '../../shared/types'
import type { ITransport, ProbeResult, SpawnOptions } from './types'
import { runProbe } from './probe'

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

    return spawn(
      'wsl.exe',
      ['-d', host.distro, '--cd', path, '--', 'claude', ...claudeArgs],
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
      args: ['-d', host.distro, '--', 'claude', '--version'],
      // wsl.exe cold start can be slow; give it more headroom than local.
      timeoutMs: 15_000
    })
  }
}
