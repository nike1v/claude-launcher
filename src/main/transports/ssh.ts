import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { HostType } from '../../shared/types'
import type { ITransport, ProbeResult, SpawnOptions } from './types'
import { runProbe } from './probe'

export class SshTransport implements ITransport {
  public spawn(options: SpawnOptions): ChildProcess {
    const { host, path, model, resumeSessionId } = options
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

    const sshArgs = ['-T', ...sshConnectArgs(host)]
    sshArgs.push(sshTarget(host), remoteCommand)

    return spawn('ssh', sshArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !key.startsWith('CLAUDE_CODE_') && key !== 'CLAUDE_RPC_TOKEN'
        )
      )
    })
  }

  public probe(host: HostType): Promise<ProbeResult> {
    if (host.kind !== 'ssh') {
      return Promise.resolve({ ok: false, reason: 'SshTransport requires ssh host' })
    }
    const args = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8']
    args.push(...sshConnectArgs(host))
    args.push(sshTarget(host), 'claude --version')
    return runProbe({ bin: 'ssh', args, timeoutMs: 20_000 })
  }
}

function sshConnectArgs(host: Extract<HostType, { kind: 'ssh' }>): string[] {
  const args: string[] = []
  if (host.port) args.push('-p', String(host.port))
  if (host.keyFile) args.push('-i', host.keyFile)
  return args
}

// `ssh user@host` when user is set; bare `ssh host` otherwise so OpenSSH
// looks up the Host alias in ~/.ssh/config and pulls user/port/key from there.
function sshTarget(host: Extract<HostType, { kind: 'ssh' }>): string {
  return host.user ? `${host.user}@${host.host}` : host.host
}
