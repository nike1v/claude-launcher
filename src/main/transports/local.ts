import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { HostType } from '../../shared/types'
import type { ITransport, ProbeResult, SpawnOptions } from './types'
import { runProbe } from './probe'

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

    return spawn('claude', claudeArgs, {
      cwd: path,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  }

  public probe(_host: HostType): Promise<ProbeResult> {
    return runProbe({ bin: 'claude', args: ['--version'], timeoutMs: 6000 })
  }
}
