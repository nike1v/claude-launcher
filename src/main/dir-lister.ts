import { spawn } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { HostType } from '../shared/types'
import { shQuote } from './transports/path-probe'
import { validateSshHost, validateWslDistro } from './transports/validate-ssh'

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
  // POSIX find with -maxdepth 1 -mindepth 1 keeps it cheap even on big trees.
  const script =
    `t=${shQuote(target)}; ` +
    `[ -z "$t" ] && t=$HOME; ` +
    `case "$t" in ~|~/*) t="$HOME${'$'}{t#~}" ;; esac; ` +
    `cd "$t" 2>/dev/null || exit 2; ` +
    `pwd; ` +
    `find . -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sed 's|^\\./||' | sort | head -${MAX_DIR_LIST_ENTRIES}`

  const { bin, args } = remoteShellCommand(host, script)
  const stdout = await runRemote(bin, args)
  const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean)
  const cwd = lines[0] ?? target
  const entries = lines.slice(1).filter(name => !name.startsWith('.'))
  return { cwd, entries }
}

function remoteShellCommand(host: HostType, script: string): { bin: string; args: string[] } {
  if (host.kind === 'wsl') {
    validateWslDistro(host.distro)
    // The script only uses cd/pwd/find/sed/head/sort — all in /usr/bin which
    // is on every default PATH, so a plain `bash -c` (no profile sourcing)
    // is enough. Avoiding -l keeps this fast and skirts any user-profile
    // side-effects.
    return { bin: 'wsl.exe', args: ['-d', host.distro, '--', 'bash', '-c', script] }
  }
  if (host.kind === 'ssh') {
    validateSshHost(host)
    const args = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=4']
    if (host.port) args.push('-p', String(host.port))
    if (host.keyFile) args.push('-i', host.keyFile)
    // Bare host = ~/.ssh/config alias; user@host overrides config user.
    args.push(host.user ? `${host.user}@${host.host}` : host.host, `sh -c ${shQuote(script)}`)
    return { bin: 'ssh', args }
  }
  throw new Error(`Unsupported host kind: ${host.kind}`)
}

function runRemote(bin: string, args: string[]): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
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
  })
}

