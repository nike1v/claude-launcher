import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { HostType } from '../../shared/types'
import type { ITransport, ProbeResult, SpawnOptions } from './types'
import { runProbe } from './probe'
import { buildClaudeArgs } from './shared'

export class LocalTransport implements ITransport {
  public spawn(options: SpawnOptions): ChildProcess {
    const { path, model, resumeSessionId } = options
    // Direct spawn — Electron is normally launched from a shell that has
    // already sourced the user's profile, so claude is on the inherited PATH.
    // Routing through `bash -lc 'claude "$@"'` re-sources the user profile on
    // every turn and, in some setups, closes stdin during sourcing so claude's
    // stream-json mode bails with "no stdin data received in 3s".
    return spawn('claude', buildClaudeArgs(model, resumeSessionId), {
      cwd: path,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  }

  public probe(_host: HostType): Promise<ProbeResult> {
    return runProbe({ bin: 'claude', args: ['--version'], timeoutMs: 6000 })
  }
}
