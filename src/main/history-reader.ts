import { spawn } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HostType } from '../shared/types'
import type { NormalizedEvent } from '../shared/events'
import { claudeProjectSlug } from '../shared/host-utils'
import { validateSshHost, validateWslDistro } from './transports/validate-ssh'
import { sshConnectArgs, sshTarget } from './transports/ssh-args'
import { getProvider } from './providers/registry'
import type { ProviderKind } from '../shared/events'

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
  events: NormalizedEvent[]
  // Populated when we returned [] for a non-trivial reason — slug mismatch,
  // ssh refused, file missing, etc. The renderer logs this to its console
  // so the user sees it in DevTools (main-process console.* doesn't reach
  // browser DevTools, which is what the user actually has open).
  diagnostic?: string
}

export class HistoryReader {
  public async loadSessionEvents(
    host: HostType,
    projectPath: string,
    sessionId: string,
    providerKind: ProviderKind
  ): Promise<HistoryLoadResult> {
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      return { events: [], diagnostic: `rejected sessionId ${JSON.stringify(sessionId)} (must match ${SESSION_ID_PATTERN})` }
    }
    const adapter = getProvider(providerKind).createAdapter()
    if (providerKind === 'codex') {
      return this.loadCodexSession(host, sessionId, adapter)
    }
    // Cursor / opencode keep state inside the agent — no on-disk
    // transcript we can read. Resume happens via session/load over
    // the protocol; backfill there is the agent's job. Return empty
    // here so the caller (cold-restore path) doesn't surface a
    // misleading "file not found" diagnostic.
    if (providerKind === 'cursor' || providerKind === 'opencode') {
      return { events: [] }
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
      return { events: adapter.parseTranscript(content) }
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
      return {
        events: adapter.parseTranscript(result.stdout),
        diagnostic: `${host.kind} \`cat "${filePath}"\` exited ${result.exitCode}; stderr: ${result.stderr.trim().slice(-500) || '(empty)'}`
      }
    }
    return { events: adapter.parseTranscript(result.stdout) }
  }

  // Codex rollouts live under $CODEX_HOME/sessions/<YYYY>/<MM>/<DD>/
  // with filenames of the form `rollout-<iso-stamp>-<sessionId>.jsonl`.
  // Date-sharding means we don't know the subdirectory from sessionId
  // alone — `find` for the suffix and cat the first match.
  // sessionId has already been validated against SESSION_ID_PATTERN
  // so it's safe to drop into the find pattern unquoted.
  private async loadCodexSession(host: HostType, sessionId: string, adapter: ReturnType<ReturnType<typeof getProvider>['createAdapter']>): Promise<HistoryLoadResult> {
    // The script: find the rollout, abort cleanly if not found, print
    // the matched path to stderr (so we can surface it in diagnostics)
    // and cat its contents to stdout. `head -n 1` ensures we cat at
    // most one match in the unlikely event of duplicates.
    const findScript =
      `f=$(find "$HOME/.codex/sessions" -type f -name "*-${sessionId}.jsonl" 2>/dev/null | head -n 1); ` +
      `if [ -z "$f" ]; then echo "rollout not found for ${sessionId} under \\$HOME/.codex/sessions" 1>&2; exit 2; fi; ` +
      `echo "matched: $f" 1>&2; cat "$f"`
    let cmd: { bin: string; args: string[] }
    if (host.kind === 'local') {
      cmd = { bin: 'bash', args: ['-c', findScript] }
    } else if (host.kind === 'wsl') {
      try { validateWslDistro(host.distro) } catch (err) {
        return { events: [], diagnostic: err instanceof Error ? err.message : 'invalid wsl distro' }
      }
      cmd = { bin: 'wsl.exe', args: ['-d', host.distro, '--', 'bash', '-c', findScript] }
    } else if (host.kind === 'ssh') {
      try { validateSshHost(host) } catch (err) {
        return { events: [], diagnostic: err instanceof Error ? err.message : 'invalid ssh host' }
      }
      cmd = {
        bin: 'ssh',
        args: ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=4',
          ...sshConnectArgs(host), sshTarget(host), findScript]
      }
    } else {
      return { events: [], diagnostic: `unsupported host kind: ${(host as { kind: string }).kind}` }
    }
    let result: StreamResult
    try {
      result = await streamCommand(cmd.bin, cmd.args)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      return { events: [], diagnostic: `codex rollout lookup threw: ${reason}` }
    }
    const stderrTail = result.stderr.trim().slice(-500)
    if (result.exitCode !== 0) {
      return {
        events: [],
        diagnostic: `codex rollout lookup exited ${result.exitCode}; stderr: ${stderrTail || '(empty)'}`
      }
    }
    const events = adapter.parseTranscript(result.stdout)
    if (events.length === 0) {
      // We found and read a file (exit 0) but it parsed to zero
      // renderable events. Surface the path stderr printed so the
      // user can verify the rollout content if needed.
      return {
        events: [],
        diagnostic: `codex rollout for ${sessionId} parsed to 0 events (${result.stdout.length} bytes read; ${stderrTail || 'no stderr'})`
      }
    }
    return {
      events,
      // Surface the path even on success so the renderer console
      // shows where the history came from — useful when the user
      // says "I expected the other session, not this one".
      diagnostic: stderrTail || undefined
    }
  }

  // Returns the session ids (jsonl filename minus extension) found in
  // claude's transcripts directory for this project. Powers the
  // session-id autocomplete in the project-edit modal so the user can
  // pick from real conversations instead of typing a UUID by hand.
  // Returns [] when the directory doesn't exist (fresh project) or when
  // the env is unreachable — never throws, callers treat empty as "no
  // suggestions" rather than a hard failure.
  public async listSessionIds(host: HostType, projectPath: string): Promise<string[]> {
    if (host.kind === 'local') {
      try {
        const entries = await readdir(localClaudeProjectDir(projectPath))
        return entries
          .filter(name => name.endsWith('.jsonl'))
          .map(name => name.slice(0, -'.jsonl'.length))
      } catch {
        return []
      }
    }

    // Remote: ask the env to list .jsonl filenames in the transcripts
    // dir. `2>/dev/null` swallows "no such file" so a fresh project
    // returns an empty list rather than an error message.
    const dir = remoteClaudeProjectDir(projectPath)
    const remoteCmd = `ls -1 ${dir} 2>/dev/null | grep '\\.jsonl$' || true`
    let cmd: { bin: string; args: string[] }
    try {
      if (host.kind === 'wsl') {
        validateWslDistro(host.distro)
        cmd = { bin: 'wsl.exe', args: ['-d', host.distro, '--', 'bash', '-c', remoteCmd] }
      } else if (host.kind === 'ssh') {
        validateSshHost(host)
        cmd = {
          bin: 'ssh',
          args: ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=4',
            ...sshConnectArgs(host), sshTarget(host), remoteCmd]
        }
      } else {
        return []
      }
    } catch {
      return []
    }
    let result: StreamResult
    try {
      result = await streamCommand(cmd.bin, cmd.args)
    } catch {
      return []
    }
    return result.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.endsWith('.jsonl'))
      .map(line => line.slice(0, -'.jsonl'.length))
  }
}


function localClaudeProjectDir(projectPath: string): string {
  return join(homedir(), '.claude', 'projects', claudeProjectSlug(projectPath))
}

function remoteClaudeProjectDir(projectPath: string): string {
  // Use $HOME (not ~) so the path expands inside the double-quoted string we
  // pass to bash -c. Tildes don't expand inside any kind of quotes.
  return `$HOME/.claude/projects/${shellEscape(claudeProjectSlug(projectPath))}`
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
