import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { HostType } from '../../shared/types'
import type { ITransport, ProbeOptions, ProbeResult, SpawnOptions } from './types'
import { runShellProbe } from './probe'
import { validateProjectPath } from './validate-path'

export class LocalTransport implements ITransport {
  public spawn(options: SpawnOptions): ChildProcess {
    const { path, bin, args } = options
    validateProjectPath(path)
    // Direct spawn — Electron is normally launched from a shell that has
    // already sourced the user's profile, so the provider binary is on
    // the inherited PATH. Routing through `bash -lc '<bin> "$@"'` re-sources
    // the user profile on every turn and, in some setups, closes stdin
    // during sourcing so claude's stream-json mode bails with "no stdin
    // data received in 3s".
    return spawn(bin, [...args], {
      cwd: path,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  }

  public async probe(_host: HostType, opts: ProbeOptions): Promise<ProbeResult> {
    const r = await runShellProbe({
      bin: opts.bin,
      args: ['--version'],
      versionLine: opts.versionLine,
      timeoutMs: 6000
    })
    return r.ok
      ? { ok: true, version: r.version ?? '' }
      : { ok: false, reason: r.reason ?? 'probe failed' }
  }
}
