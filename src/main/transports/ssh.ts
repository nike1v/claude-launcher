import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { HostType } from '../../shared/types'
import type { ITransport, ProbeResult, SpawnOptions } from './types'
import { runPathProbe, probeScript, shQuote } from './path-probe'
import { getCachedPath, setCachedPath } from './path-cache'
import { validateSshHost } from './validate-ssh'
import { validateProjectPath, validateClaudeArg } from './validate-path'
import { buildClaudeArgs, filteredEnv } from './shared'

export class SshTransport implements ITransport {
  public spawn(options: SpawnOptions): ChildProcess {
    const { host, path, model, resumeSessionId } = options
    if (host.kind !== 'ssh') throw new Error('SshTransport requires ssh host')
    validateSshHost(host)
    validateProjectPath(path)
    if (model) validateClaudeArg(model, 'model')
    if (resumeSessionId) validateClaudeArg(resumeSessionId, 'resumeSessionId')

    const claudeArgs = buildClaudeArgs(model, resumeSessionId)

    // OpenSSH runs the remote command as `<user-shell> -c <cmd>` — that's
    // non-interactive non-login on the remote, so ~/.bashrc / ~/.profile
    // aren't sourced and claude installed via npm-global / ~/.local/bin is
    // invisible. The probe ran a login bash + bashrc once and cached PATH;
    // we set it explicitly here and exec claude so stdin/stdout passthrough
    // stays clean (the previous `bash -lc` wrapper interfered with stdin
    // in some setups, making stream-json mode bail at the 3s timeout).
    //
    // *** Use shQuote(...) — NOT JSON.stringify — for path and each arg. ***
    // The remote `sh -c` parses our string as a script. JSON.stringify wraps
    // the value in double quotes, but inside double quotes `$(...)` and
    // backticks still expand, so a path of `$(reboot)` (from a tampered
    // projects.json or even a misclick in PathCombobox) would execute on
    // the remote. Single-quote wrapping is inert.
    const cachedPath = getCachedPath(host)
    const quotedArgs = claudeArgs.map(arg => shQuote(arg)).join(' ')
    const pathExport = cachedPath ? `export PATH=${shQuote(cachedPath)}; ` : ''
    const innerScript = `${pathExport}cd ${shQuote(path)} && exec claude ${quotedArgs}`
    const remoteCommand = `sh -c ${shQuote(innerScript)}`

    const sshArgs = ['-T', ...sshConnectArgs(host)]
    sshArgs.push(sshTarget(host), remoteCommand)

    return spawn('ssh', sshArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: filteredEnv()
    })
  }

  public async probe(host: HostType): Promise<ProbeResult> {
    if (host.kind !== 'ssh') {
      return { ok: false, reason: 'SshTransport requires ssh host' }
    }
    try {
      validateSshHost(host)
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'invalid ssh config' }
    }
    const args = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8']
    args.push(...sshConnectArgs(host))
    args.push(sshTarget(host), `bash -lc ${shQuote(probeScript())}`)
    const result = await runPathProbe({ bin: 'ssh', args, timeoutMs: 25_000 })
    if (result.path) setCachedPath(host, result.path)
    return result.ok
      ? { ok: true, version: result.version ?? '' }
      : { ok: false, reason: result.reason ?? 'probe failed' }
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
