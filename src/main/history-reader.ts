import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import type { HostType, StreamJsonEvent } from '../shared/types'
import { parseStreamJsonLine } from './stream-json-parser'

// JSONL transcripts can be hundreds of KB and grow unbounded; reading them via
// execFile would silently truncate (default 1 MiB stdout buffer) and reject
// with ERR_CHILD_PROCESS_STDOUT_MAXBUFFER, which our caller then turns into
// "no history". Streaming the child's stdout sidesteps both the size cap and
// the hard 5 s timeout we used previously (cold-start `wsl.exe` can blow past
// it).
const REMOTE_READ_TIMEOUT_MS = 30_000

function streamCommand(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let settled = false
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Detach all listeners before kill so a chunk that fires between
      // `kill` and the actual process exit doesn't push into a buffer that
      // nobody owns any more.
      child.stdout.removeAllListeners('data')
      child.stderr.removeAllListeners('data')
      fn()
    }
    const timer = setTimeout(() => {
      settle(() => {
        try { child.kill() } catch { /* already exited */ }
        reject(new Error('timeout'))
      })
    }, REMOTE_READ_TIMEOUT_MS)
    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.stderr.on('data', () => {})
    child.on('error', (err) => { settle(() => reject(err)) })
    child.on('close', () => {
      settle(() => resolve(Buffer.concat(chunks).toString('utf-8')))
    })
  })
}

export class HistoryReader {
  public async loadSessionEvents(host: HostType, projectPath: string, sessionId: string): Promise<StreamJsonEvent[]> {
    if (host.kind === 'local') {
      const filePath = join(localClaudeProjectDir(projectPath), `${sessionId}.jsonl`)
      let content: string
      try {
        content = await readFile(filePath, 'utf-8')
      } catch {
        return []
      }
      return parseJsonl(content)
    }

    const filePath = `${remoteClaudeProjectDir(projectPath)}/${shellEscape(sessionId)}.jsonl`
    const command = buildCatCommand(host, filePath)
    let output: string
    try {
      output = await streamCommand(command.bin, command.args)
    } catch {
      return []
    }
    return parseJsonl(output)
  }
}

function parseJsonl(content: string): StreamJsonEvent[] {
  return content.split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => parseStreamJsonLine(line))
    .filter((e): e is StreamJsonEvent => e !== null)
}

function localClaudeProjectDir(projectPath: string): string {
  const slug = projectPath.split(sep).join('-')
  return join(homedir(), '.claude', 'projects', slug)
}

function remoteClaudeProjectDir(projectPath: string): string {
  // Use $HOME (not ~) so the path expands inside the double-quoted string we
  // pass to bash -c. Tildes don't expand inside any kind of quotes.
  const slug = projectPath.split('/').join('-')
  return `$HOME/.claude/projects/${shellEscape(slug)}`
}

// Quote-only escape for embedding inside a bash double-quoted string. We
// keep this distinct from path-probe's `shQuote` (which wraps the whole
// string in single quotes) — the call sites here interpolate the result
// inside `"..."` so they need backslash-escapes for the four chars that
// retain meaning under double-quotes; a single-quote wrap would break the
// $HOME expansion the caller relies on.
function shellEscape(s: string): string {
  return s.replace(/[\\"`$]/g, '\\$&')
}

function buildCatCommand(host: HostType, filePath: string): { bin: string; args: string[] } {
  const cmd = `cat "${filePath}" 2>/dev/null`
  if (host.kind === 'wsl') {
    return { bin: 'wsl.exe', args: ['-d', host.distro, '--', 'bash', '-c', cmd] }
  }
  const sshArgs = ['-T']
  if (host.port) sshArgs.push('-p', String(host.port))
  if (host.keyFile) sshArgs.push('-i', host.keyFile)
  sshArgs.push(`${host.user}@${host.host}`, cmd)
  return { bin: 'ssh', args: sshArgs }
}
