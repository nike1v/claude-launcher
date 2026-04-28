import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { HostType } from '../../shared/types'
import type { ITransport, ProbeResult, SpawnOptions } from './types'
import { runPathProbe, probeScript } from './path-probe'
import { getCachedPath, setCachedPath } from './path-cache'
import { validateWslDistro } from './validate-ssh'
import { buildClaudeArgs, filteredEnv } from './shared'

export class WslTransport implements ITransport {
  public spawn(options: SpawnOptions): ChildProcess {
    const { host, path, model, resumeSessionId } = options
    if (host.kind !== 'wsl') throw new Error('WslTransport requires wsl host')
    validateWslDistro(host.distro)

    // wsl.exe spawns a non-login non-interactive shell that ignores
    // ~/.profile etc., so claude installed via npm-global / ~/.local/bin is
    // invisible to a bare `wsl.exe -- claude`. The probe ran a login bash
    // and cached the resulting PATH; we surface it via `env PATH=...` so
    // claude sees the right PATH without us having to keep a bash sitting
    // between Node and claude (that wrapper closed stdin in some setups).
    const cachedPath = getCachedPath(host)
    const wslArgs = ['-d', host.distro, '--cd', path, '--']
    if (cachedPath) wslArgs.push('env', `PATH=${cachedPath}`)
    wslArgs.push('claude', ...buildClaudeArgs(model, resumeSessionId))

    return spawn('wsl.exe', wslArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: filteredEnv()
    })
  }

  public async probe(host: HostType): Promise<ProbeResult> {
    if (host.kind !== 'wsl') {
      return { ok: false, reason: 'WslTransport requires wsl host' }
    }
    try {
      validateWslDistro(host.distro)
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'invalid wsl config' }
    }
    const result = await runPathProbe({
      bin: 'wsl.exe',
      args: ['-d', host.distro, '--', 'bash', '-lc', probeScript()],
      // wsl.exe cold start + login shell sourcing can both be slow.
      timeoutMs: 15_000
    })
    if (result.path) setCachedPath(host, result.path)
    return result.ok
      ? { ok: true, version: result.version ?? '' }
      : { ok: false, reason: result.reason ?? 'probe failed' }
  }
}
