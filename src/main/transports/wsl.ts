import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { HostType } from '../../shared/types'
import type { ITransport, ProbeOptions, ProbeResult, SpawnOptions } from './types'
import { runShellProbe, probeScript } from './probe'
import { getCachedProbe, setCachedProbe } from './path-cache'
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
    // and cached both the resolved PATH and the remote $HOME; we surface
    // them via `env PATH=...` so the child sees the right PATH without
    // us having to keep a bash sitting between Node and the binary.
    //
    // We also defensively prepend a few installer-default dirs as
    // absolute paths (using the cached HOME, no shell expansion needed
    // through wsl.exe argv). This covers the case where the cached PATH
    // somehow didn't include ~/.opencode/bin etc. — happened to a real
    // user despite the probe script's $HOME prepend, root cause never
    // fully isolated, so we belt-and-suspenders it here too.
    const cached = getCachedProbe(host)
    const cachedPath = cached?.path
    const home = cached?.home
    const installerDirs = home
      ? [
          `${home}/.opencode/bin`,
          `${home}/.bun/bin`,
          `${home}/.cargo/bin`,
          `${home}/.npm-global/bin`,
          `${home}/.local/bin`,
          '/usr/local/bin'
        ]
      : []
    const fullPath = [...installerDirs, ...(cachedPath ? [cachedPath] : [])].join(':')
    const wslArgs = ['-d', host.distro, '--cd', path, '--']
    if (fullPath) wslArgs.push('env', `PATH=${fullPath}`)
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
    if (result.path) setCachedProbe(host, result.path, result.home)
    return result.ok
      ? { ok: true, version: result.version ?? '' }
      : { ok: false, reason: result.reason ?? 'probe failed' }
  }
}
