import { spawn } from 'node:child_process'
import type { ProbeResult } from './types'

const PATH_MARKER = '__CL_PATH='

// One-shot bash script: source the user's login + bashrc PATH, print it on a
// dedicated marker line, then run `claude --version` so the same probe
// validates the binary. Used by WSL and SSH transports where wsl.exe / a
// non-interactive ssh shell otherwise miss profile-only PATH additions
// (~/.local/bin via .profile, npm-global, asdf shims, mise, etc.).
//
// `printf` (not `echo`) so unusual PATH characters survive intact, and we
// guard the bashrc source with `[ -f ~/.bashrc ]` to avoid noise on hosts
// that don't have one.
export function probeScript(): string {
  return `[ -f ~/.bashrc ] && . ~/.bashrc 2>/dev/null; printf '${PATH_MARKER}%s\\n' "$PATH"; claude --version`
}

interface PathProbeOpts {
  bin: string
  args: string[]
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

export interface PathProbeResult {
  ok: boolean
  version?: string
  path?: string
  reason?: string
}

export function runPathProbe(opts: PathProbeOpts): Promise<PathProbeResult> {
  const timeout = opts.timeoutMs ?? 15_000
  return new Promise<PathProbeResult>((resolve) => {
    let out = ''
    let err = ''
    let settled = false
    const finish = (r: PathProbeResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }
    const child = spawn(opts.bin, opts.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: opts.env
    })
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already dead */ }
      finish({ ok: false, reason: '`claude --version` timed out' })
    }, timeout)
    child.stdout?.on('data', (b: Buffer) => { out += b.toString('utf-8') })
    child.stderr?.on('data', (b: Buffer) => { err += b.toString('utf-8') })
    child.on('error', (e: NodeJS.ErrnoException) => {
      finish({ ok: false, reason: friendlyEnoent(opts.bin, e) })
    })
    child.on('close', (code) => {
      const lines = (out + '\n' + err).split('\n')
      const pathLine = lines.find(l => l.startsWith(PATH_MARKER))
      const path = pathLine ? pathLine.slice(PATH_MARKER.length).trim() : undefined
      const versionLine = lines.find(l => /Claude Code/i.test(l))
      if (code === 0 && versionLine) {
        finish({ ok: true, version: versionLine.trim(), path })
      } else if (code === 0) {
        const text = (out + err).trim()
        finish({
          ok: false,
          reason: text ? `Got non-Claude-Code output:\n${text}` : '`claude --version` produced no output',
          path
        })
      } else {
        const text = err.trim() || out.trim() || `\`claude --version\` exited with code ${code}`
        finish({ ok: false, reason: text, path })
      }
    })
  })
}

function friendlyEnoent(bin: string, e: NodeJS.ErrnoException): string {
  if (e.code === 'ENOENT') {
    if (bin === 'wsl.exe') return 'wsl.exe not found — WSL is not installed.'
    if (bin === 'ssh') return 'ssh not found on PATH.'
    if (bin === 'bash') return 'bash not found on PATH.'
  }
  return e.message || 'spawn failed'
}

// POSIX single-quote escape for embedding strings inside `'...'` in remote
// shell scripts (used to wrap probeScript() for ssh's bash -lc invocation).
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
