import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { HostType } from '../../shared/types'
import type { ITransport, ProbeOptions, ProbeResult, SpawnOptions } from './types'
import { runShellProbe, probeScript } from './probe'
import { getCachedPath, setCachedPath } from './path-cache'
import { validateWslDistro } from './validate-ssh'
import { validateProjectPath } from './validate-path'
import { filteredEnvFor } from './shared'

export class WslTransport implements ITransport {
  public spawn(options: SpawnOptions): ChildProcess {
    const { host, path, bin, args, envScrubKeys = [] } = options
    if (host.kind !== 'wsl') throw new Error('WslTransport requires wsl host')
    validateWslDistro(host.distro)
    validateProjectPath(path)

    // wsl.exe spawns a non-login non-interactive shell that ignores
    // ~/.profile etc., so a binary installed via npm-global / ~/.local/bin
    // is invisible to a bare `wsl.exe -- <bin>`. The probe ran a login bash
    // and cached the resulting PATH; we surface it via `env PATH=...` so
    // the child sees the right PATH without us having to keep a bash
    // sitting between Node and the binary (that wrapper closed stdin in
    // some setups, AND a 0.7.1 attempt to use `bash -c '...; exec "$@"'`
    // for stronger PATH guarantees broke spawn end-to-end on real WSL
    // for unclear reasons — the env+cached form is what's been
    // production-tested).
    //
    // The cached PATH is populated by `transport.probe`, which now
    // unconditionally prepends installer-default dirs via $HOME inside
    // the probe script (~/.opencode/bin, ~/.cargo/bin, etc.). So the
    // cache covers anything an installer puts in those dirs even when
    // the user's profile didn't add it to PATH. See probe.ts.
    const cachedPath = getCachedPath(host)
    const wslArgs = ['-d', host.distro, '--cd', path, '--']
    if (cachedPath) wslArgs.push('env', `PATH=${cachedPath}`)
    wslArgs.push(bin, ...args)

    return spawn('wsl.exe', wslArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: filteredEnvFor(envScrubKeys)
    })
  }

  public async probe(host: HostType, opts: ProbeOptions): Promise<ProbeResult> {
    if (host.kind !== 'wsl') {
      return { ok: false, reason: 'WslTransport requires wsl host' }
    }
    try {
      validateWslDistro(host.distro)
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'invalid wsl config' }
    }
    const result = await runShellProbe({
      bin: 'wsl.exe',
      args: ['-d', host.distro, '--', 'bash', '-lc', probeScript(opts.bin)],
      versionLine: opts.versionLine,
      // wsl.exe cold start + login shell sourcing can both be slow.
      timeoutMs: 15_000
    })
    if (result.path) setCachedPath(host, result.path)
    return result.ok
      ? { ok: true, version: result.version ?? '' }
      : { ok: false, reason: result.reason ?? 'probe failed' }
  }
}
