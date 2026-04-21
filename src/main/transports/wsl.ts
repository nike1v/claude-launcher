import {spawn} from 'node:child_process'
import type {ChildProcess} from 'node:child_process'
import type {ITransport, SpawnOptions} from './types'

export class WslTransport implements ITransport {
  public spawn(options: SpawnOptions): ChildProcess {
    const {host, path, model, resumeSessionId} = options
    if (host.kind !== 'wsl') throw new Error('WslTransport requires wsl host')

    const claudeArgs = [
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
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
}
