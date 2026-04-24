import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { ITransport, SpawnOptions } from './types'

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
}
