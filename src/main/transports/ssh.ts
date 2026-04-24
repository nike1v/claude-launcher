import {spawn} from 'node:child_process'
import type {ChildProcess} from 'node:child_process'
import type {ITransport, SpawnOptions} from './types'

export class SshTransport implements ITransport {
  public spawn(options: SpawnOptions): ChildProcess {
    const {host, path, model, resumeSessionId} = options
    if (host.kind !== 'ssh') throw new Error('SshTransport requires ssh host')

    const claudeArgs = [
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--permission-prompt-tool', 'stdio'
    ]
    if (model) claudeArgs.push('--model', model)
    if (resumeSessionId) claudeArgs.push('--resume', resumeSessionId)

    const quotedArgs = claudeArgs.map(arg => JSON.stringify(arg)).join(' ')
    const remoteCommand = `cd ${JSON.stringify(path)} && claude ${quotedArgs}`

    const sshArgs = ['-T']
    if (host.port) sshArgs.push('-p', String(host.port))
    if (host.keyFile) sshArgs.push('-i', host.keyFile)
    sshArgs.push(`${host.user}@${host.host}`, remoteCommand)

    return spawn('ssh', sshArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !key.startsWith('CLAUDE_CODE_') && key !== 'CLAUDE_RPC_TOKEN'
        )
      )
    })
  }
}
