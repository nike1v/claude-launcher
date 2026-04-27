import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { HostType } from '../../shared/types'
import type { ITransport, ProbeResult, SpawnOptions } from './types'
import { runProbe } from './probe'
import { loginShellArgs } from './shell'

const IS_WINDOWS = process.platform === 'win32'

export class LocalTransport implements ITransport {
  public spawn(options: SpawnOptions): ChildProcess {
    const { path, model, resumeSessionId } = options

    const claudeArgs = [
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--permission-prompt-tool', 'stdio'
    ]
    if (model) claudeArgs.push('--model', model)
    if (resumeSessionId) claudeArgs.push('--resume', resumeSessionId)

    if (IS_WINDOWS) {
      // Windows installers and `npm i -g` both put claude on the user's
      // PATH that Electron inherits, so a direct spawn is fine.
      return spawn('claude', claudeArgs, {
        cwd: path,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    }

    // Linux/macOS: route through `bash -lc 'claude "$@"'` so user-profile
    // PATH (commonly puts ~/.local/bin, asdf shims, etc.) is in scope.
    return spawn('bash', loginShellArgs('claude "$@"', claudeArgs), {
      cwd: path,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  }

  public probe(_host: HostType): Promise<ProbeResult> {
    if (IS_WINDOWS) {
      return runProbe({ bin: 'claude', args: ['--version'], timeoutMs: 6000 })
    }
    // Login shell adds startup overhead; bump the timeout slightly.
    return runProbe({ bin: 'bash', args: ['-lc', 'claude --version'], timeoutMs: 8000 })
  }
}
