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
    // ~/.profile etc., so a binary installed via npm-global /
    // ~/.local/bin / ~/.opencode/bin is invisible to a bare
    // `wsl.exe -- <bin>`. We use a `bash -c '<prepend>; exec "$@"'`
    // wrapper that:
    //   1. Unconditionally prepends installer-default dirs via $HOME
    //      (mirrors what probe does, in case the cached PATH doesn't
    //      cover this provider — opencode lived in ~/.opencode/bin
    //      that the cache wasn't reliably catching).
    //   2. Falls back through cachedPath (built by probe with full
    //      profile sourcing) for everything else.
    //   3. Uses `exec "$@"` so bash replaces itself with the CLI
    //      binary — stdin / stdout / stderr pass through cleanly,
    //      avoiding the "claude stream-json sees EOF" issue that
    //      bit `bash -lc 'claude "$@"'` in earlier versions.
    const cachedPath = getCachedPath(host)
    const fallbackPath = cachedPath ?? '$PATH'
    const homePrepend = '$HOME/.opencode/bin:$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin'
    const script = `PATH="${homePrepend}:${fallbackPath}"; exec "$@"`
    const wslArgs = ['-d', host.distro, '--cd', path, '--', 'bash', '-c', script, '--', bin, ...args]

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
