import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { HostType } from '../../shared/types'
import type { ITransport, ProbeOptions, ProbeResult, SpawnOptions } from './types'
import { runShellProbe, probeScript, shQuote } from './probe'
import { getCachedPath, setCachedPath } from './path-cache'
import { validateSshHost } from './validate-ssh'
import { validateProjectPath } from './validate-path'
import { filteredEnvFor } from './shared'
import { sshConnectArgs, sshTarget } from './ssh-args'

export class SshTransport implements ITransport {
  public spawn(options: SpawnOptions): ChildProcess {
    const { host, path, bin, args, envScrubKeys = [] } = options
    if (host.kind !== 'ssh') throw new Error('SshTransport requires ssh host')
    validateSshHost(host)
    validateProjectPath(path)

    // OpenSSH runs the remote command as `<user-shell> -c <cmd>` — that's
    // non-interactive non-login on the remote, so ~/.bashrc / ~/.profile
    // aren't sourced and a binary installed via npm-global / ~/.local/bin
    // is invisible. The probe ran a login bash + bashrc once and cached
    // PATH; we set it explicitly here and exec the binary so stdin/stdout
    // passthrough stays clean (the previous `bash -lc` wrapper interfered
    // with stdin in some setups, making stream-json mode bail at the 3s
    // timeout).
    //
    // *** Use shQuote(...) — NOT JSON.stringify — for path and each arg. ***
    // The remote `sh -c` parses our string as a script. JSON.stringify
    // wraps the value in double quotes, but inside double quotes `$(...)`
    // and backticks still expand, so a path of `$(reboot)` (from a
    // tampered projects.json or even a misclick in PathCombobox) would
    // execute on the remote. Single-quote wrapping is inert.
    const cachedPath = getCachedPath(host)
    const quotedArgs = args.map(arg => shQuote(arg)).join(' ')
    const pathExport = cachedPath ? `export PATH=${shQuote(cachedPath)}; ` : ''
    const innerScript = `${pathExport}cd ${shQuote(path)} && exec ${shQuote(bin)} ${quotedArgs}`
    const remoteCommand = `sh -c ${shQuote(innerScript)}`

    const sshArgs = ['-T', ...sshConnectArgs(host)]
    sshArgs.push(sshTarget(host), remoteCommand)

    return spawn('ssh', sshArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: filteredEnvFor(envScrubKeys)
    })
  }

  public async probe(host: HostType, opts: ProbeOptions): Promise<ProbeResult> {
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
    args.push(sshTarget(host), `bash -lc ${shQuote(probeScript(opts.bin))}`)
    const result = await runShellProbe({
      bin: 'ssh',
      args,
      versionLine: opts.versionLine,
      timeoutMs: 25_000
    })
    if (result.path) setCachedPath(host, result.path)
    return result.ok
      ? { ok: true, version: result.version ?? '' }
      : { ok: false, reason: result.reason ?? 'probe failed' }
  }
}
