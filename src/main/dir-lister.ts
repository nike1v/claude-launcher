import { spawn } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { HostType } from '../shared/types'
import { shQuote } from './transports/probe'
import { validateSshHost, validateWslDistro } from './transports/validate-ssh'
import { sshConnectArgs, sshTarget } from './transports/ssh-args'

export interface DirListing {
  // The absolute directory we ended up listing (after resolving "" / "~").
  cwd: string
  entries: string[] // sorted directory names only
}

const REMOTE_TIMEOUT_MS = 6000
// Cap how many directory names we return for one listing. Big trees
// (/usr, /home with many users) would otherwise flood the dropdown and
// hang formatting in the renderer. Tuned to "more than the user will ever
// scroll through, less than what hurts."
const MAX_DIR_LIST_ENTRIES = 200

// Lists immediate subdirectories of `path` over the given transport. The
// PathCombobox in the renderer calls this per keystroke (debounced) to
// suggest the next path segment. We only return directories — files are
// noise in this context — and cap at MAX_DIR_LIST_ENTRIES so a giant /usr
// or /home doesn't flood the dropdown.
export async function listDir(host: HostType, path: string): Promise<DirListing> {
  if (host.kind === 'local') return listLocalDir(path)
  return listRemoteDir(host, path)
}

async function listLocalDir(rawPath: string): Promise<DirListing> {
  const expanded = expandLocalPath(rawPath)
  const cwd = resolve(expanded)
  const entries = await readdir(cwd, { withFileTypes: true })
  const dirs: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      // Resolve symlinks lazily — only when it might be a directory link.
      if (!entry.isSymbolicLink()) continue
      try {
        const s = await stat(join(cwd, entry.name))
        if (!s.isDirectory()) continue
      } catch { continue }
    }
    if (entry.name.startsWith('.')) continue
    dirs.push(entry.name)
    if (dirs.length >= MAX_DIR_LIST_ENTRIES) break
  }
  dirs.sort((a, b) => a.localeCompare(b))
  return { cwd, entries: dirs }
}

function expandLocalPath(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return homedir()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~' + sep)) return join(homedir(), trimmed.slice(2))
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2))
  return trimmed
}

async function listRemoteDir(host: HostType, rawPath: string): Promise<DirListing> {
  const target = rawPath.trim() || '~'
  // Resolve the path on the remote and emit one directory name per line.
  //
  // The previous implementation `cd "$t"; pwd; find . …` was fragile when
  // shipped through `wsl.exe -- bash -c "<script>"`: Windows argv quoting
  // could mangle the script enough that `cd` silently failed, leaving
  // `find .` to run from wsl.exe's inherited Windows cwd (the launcher's
  // install dir) and surface its `locales/` + `resources/` folders as
  // bogus suggestions. Two fixes here:
  //   1. Drive the listing off `find "$t"` with the absolute path —
  //      the result is independent of cwd, so no broken cd can ever leak
  //      a different directory's contents.
  //   2. Feed the script via stdin (`bash -s` / `sh -s`) instead of
  //      embedding it in argv. Stdin is bytewise; no Windows arg-escape
  //      step can disturb the script body.
  //
  // The tilde patterns are quoted ("~" / "~/"*) because bash subjects
  // case patterns AND ${var#pattern} pattern arguments to tilde
  // expansion — without the quotes `~` matches against $HOME, never the
  // literal `~` the user typed, and the whole branch silently no-ops.
  // Same trap on the strip side: ${t#"~"} keeps the prefix-removal
  // pattern as the literal tilde character.
  //
  // `awk -F/ '{print $NF}'` portably extracts the basename — GNU find
  // has `-printf '%f'` but BSD find (macOS over SSH) does not, so the
  // awk pipe keeps both code paths on one script.
  const script =
    `t=${shQuote(target)}\n` +
    `[ -z "$t" ] && t="$HOME"\n` +
    `case "$t" in "~") t="$HOME" ;; "~/"*) t="$HOME/${'$'}{t#"~/"}" ;; esac\n` +
    `printf '%s\\n' "$t"\n` +
    `find "$t" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | awk -F/ '{print $NF}' | sort | head -${MAX_DIR_LIST_ENTRIES}\n`

  const { bin, args } = remoteShellCommand(host)
  const stdout = await runRemote(bin, args, script)
  const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean)
  const cwd = lines[0] ?? target
  const entries = lines.slice(1).filter(name => !name.startsWith('.'))
  return { cwd, entries }
}

function remoteShellCommand(host: HostType): { bin: string; args: string[] } {
  if (host.kind === 'wsl') {
    validateWslDistro(host.distro)
    // `bash -s` reads the script from stdin, so we don't have to embed
    // it in argv — that's what `bash -c "<script>"` did, and it's how
    // the v0.7.x WSL listings ended up showing the launcher install
    // dir's `locales/resources/` instead of the requested path.
    // Avoiding `-l` skips profile sourcing (the script only uses
    // posix utilities, all on the default PATH).
    return { bin: 'wsl.exe', args: ['-d', host.distro, '--', 'bash', '-s'] }
  }
  if (host.kind === 'ssh') {
    validateSshHost(host)
    const args = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=4', ...sshConnectArgs(host)]
    // Same stdin trick over SSH: send `sh -s` and pipe the script body.
    // sshd runs the user's login shell with `-c <command>`, so we still
    // pay one shell-parse — but the script the inner `sh` actually
    // executes comes through stdin, which can't be re-quoted by the
    // outer shell.
    args.push(sshTarget(host), 'sh -s')
    return { bin: 'ssh', args }
  }
  throw new Error(`Unsupported host kind: ${host.kind}`)
}

function runRemote(bin: string, args: string[], stdin: string): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already exited */ }
      reject(new Error('directory listing timed out'))
    }, REMOTE_TIMEOUT_MS)
    child.stdout.on('data', (b: Buffer) => { out += b.toString('utf-8') })
    child.stderr.on('data', (b: Buffer) => { err += b.toString('utf-8') })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolveRun(out)
      else reject(new Error(err.trim() || `listing exited with code ${code}`))
    })
    child.stdin.end(stdin)
  })
}

