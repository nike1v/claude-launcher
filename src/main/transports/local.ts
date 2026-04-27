import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { ITransport, ProbeResult, SpawnOptions } from './types'

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

  // `claude --version` should print something like "2.1.119 (Claude Code)".
  // We use that string as the marker for a real Claude Code CLI — anything
  // else (a different program on PATH, a script that hangs, ENOENT) gets a
  // clear error before we try to start a session.
  public probe(): ProbeResult {
    try {
      const out = execFileSync('claude', ['--version'], {
        timeout: 5000,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe']
      }).trim()
      if (/Claude Code/i.test(out)) return { ok: true, version: out }
      return {
        ok: false,
        reason: `"claude --version" did not look like the Claude Code CLI:\n${out || '(empty output)'}`
      }
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException & { signal?: string }
      if (e.code === 'ENOENT') {
        return { ok: false, reason: 'No "claude" binary found on PATH. Install the Claude Code CLI to use the local environment.' }
      }
      if (e.signal === 'SIGTERM' || /timed?\s*out/i.test(e.message ?? '')) {
        return { ok: false, reason: '"claude --version" timed out. The binary on PATH probably isn\'t the Claude Code CLI.' }
      }
      return { ok: false, reason: e.message || '"claude --version" failed' }
    }
  }
}
