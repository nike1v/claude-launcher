import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import type { HostType, StreamJsonEvent } from '../shared/types'
import { parseStreamJsonLine } from './stream-json-parser'
import { validateSshHost, validateWslDistro } from './transports/validate-ssh'
import { sshConnectArgs, sshTarget } from './transports/ssh-args'

// Claude session ids are UUID-shaped strings the CLI writes into the JSONL
// transcript filename. Anything else is renderer-injected garbage and
// shouldn't be allowed near `path.join`, where `..` would escape the
// project directory and let a compromised renderer read any *.jsonl on
// disk through `session:history:load`.
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

// JSONL transcripts can be hundreds of KB and grow unbounded; reading them via
// execFile would silently truncate (default 1 MiB stdout buffer) and reject
// with ERR_CHILD_PROCESS_STDOUT_MAXBUFFER, which our caller then turns into
// "no history". Streaming the child's stdout sidesteps both the size cap and
// the hard 5 s timeout we used previously (cold-start `wsl.exe` can blow past
// it).
const REMOTE_READ_TIMEOUT_MS = 30_000
// Real claude transcripts top out around 1–2 MiB for very long sessions.
// 50 MiB is well past that; hitting it means the remote file is corrupted,
// truncated-at-the-end, or someone pointed us at the wrong path.
const MAX_REMOTE_BYTES = 50 * 1024 * 1024

interface StreamResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

function streamCommand(bin: string, args: string[]): Promise<StreamResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let totalBytes = 0
    let settled = false
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
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
    child.stdout.on('data', (c: Buffer) => {
      totalBytes += c.length
      if (totalBytes > MAX_REMOTE_BYTES) {
        settle(() => {
          try { child.kill() } catch { /* already exited */ }
          reject(new Error('remote read exceeded size cap'))
        })
        return
      }
      stdoutChunks.push(c)
    })
    // Capture stderr (was discarded) so a failed remote `cat` — missing
    // file, ssh refused, wrong slug — surfaces a real reason in the
    // console instead of silently returning [].
    child.stderr.on('data', (c: Buffer) => { stderrChunks.push(c) })
    child.on('error', (err) => { settle(() => reject(err)) })
    child.on('close', (code) => {
      settle(() => resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        exitCode: code
      }))
    })
  })
}

export interface HistoryLoadResult {
  events: StreamJsonEvent[]
  // Populated when we returned [] for a non-trivial reason — slug mismatch,
  // ssh refused, file missing, etc. The renderer logs this to its console
  // so the user sees it in DevTools (main-process console.* doesn't reach
  // browser DevTools, which is what the user actually has open).
  diagnostic?: string
}

export class HistoryReader {
  public async loadSessionEvents(host: HostType, projectPath: string, sessionId: string): Promise<HistoryLoadResult> {
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      return { events: [], diagnostic: `rejected sessionId ${JSON.stringify(sessionId)} (must match ${SESSION_ID_PATTERN})` }
    }
    if (host.kind === 'local') {
      const filePath = join(localClaudeProjectDir(projectPath), `${sessionId}.jsonl`)
      let content: string
      try {
        content = await readFile(filePath, 'utf-8')
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        return { events: [], diagnostic: `read ${filePath} failed: ${reason}` }
      }
      return { events: parseJsonl(content) }
    }

    const filePath = `${remoteClaudeProjectDir(projectPath)}/${shellEscape(sessionId)}.jsonl`
    const command = buildCatCommand(host, filePath)
    let result: StreamResult
    try {
      result = await streamCommand(command.bin, command.args)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      return { events: [], diagnostic: `${host.kind} cat ${filePath} threw: ${reason}` }
    }
    if (result.exitCode !== 0) {
      // cat 1 = file missing (likely slug mismatch with what claude on
      // remote actually wrote); ssh 255 = connection error. Hand the
      // renderer the exit code + stderr tail so the user can paste it
      // into a bug report instead of just "history doesn't load".
      return {
        events: parseJsonl(result.stdout),
        diagnostic: `${host.kind} \`cat "${filePath}"\` exited ${result.exitCode}; stderr: ${result.stderr.trim().slice(-500) || '(empty)'}`
      }
    }
    return { events: parseJsonl(result.stdout) }
  }
}

function parseJsonl(content: string): StreamJsonEvent[] {
  return content.split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => parseStreamJsonLine(line))
    .filter((e): e is StreamJsonEvent => e !== null)
}

// Trailing slashes confuse the slug — `/srv/` would split to ['', 'srv', '']
// and join into `-srv-` (extra trailing dash), but claude on the remote
// normalizes the path before slugifying so its actual transcript dir is
// `-srv`. Strip trailing separators so our slug matches what claude wrote.
function stripTrailingSep(p: string, separator: string): string {
  let end = p.length
  while (end > 1 && p[end - 1] === separator) end--
  return p.slice(0, end)
}

function localClaudeProjectDir(projectPath: string): string {
  const slug = stripTrailingSep(projectPath, sep).split(sep).join('-')
  return join(homedir(), '.claude', 'projects', slug)
}

function remoteClaudeProjectDir(projectPath: string): string {
  // Use $HOME (not ~) so the path expands inside the double-quoted string we
  // pass to bash -c. Tildes don't expand inside any kind of quotes.
  const slug = stripTrailingSep(projectPath, '/').split('/').join('-')
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
  // Don't suppress cat's stderr — when the transcript file is missing we
  // want the "No such file or directory" message to surface in main's
  // console so we can debug "history doesn't load" reports.
  const cmd = `cat "${filePath}"`
  if (host.kind === 'wsl') {
    validateWslDistro(host.distro)
    return { bin: 'wsl.exe', args: ['-d', host.distro, '--', 'bash', '-c', cmd] }
  }
  if (host.kind !== 'ssh') throw new Error(`Unsupported host kind for buildCatCommand: ${host.kind}`)
  validateSshHost(host)
  const sshArgs = ['-T', ...sshConnectArgs(host), sshTarget(host), cmd]
  return { bin: 'ssh', args: sshArgs }
}
