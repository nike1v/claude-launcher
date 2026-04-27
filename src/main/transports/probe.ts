import { spawn } from 'node:child_process'
import type { ProbeResult } from './types'

interface RunOpts {
  bin: string
  args: string[]
  timeoutMs?: number
}

// Spawn a short-lived child process, capture stdout, enforce a hard timeout.
// Used to power per-transport `claude --version` probes — the same primitive
// used by every transport so error handling stays consistent.
export function runProbe(opts: RunOpts): Promise<ProbeResult> {
  const timeout = opts.timeoutMs ?? 8000
  return new Promise<ProbeResult>((resolve) => {
    let out = ''
    let err = ''
    let settled = false
    const finish = (r: ProbeResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }
    const child = spawn(opts.bin, opts.args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already dead */ }
      finish({ ok: false, reason: '`claude --version` timed out' })
    }, timeout)
    child.stdout?.on('data', (b: Buffer) => { out += b.toString('utf-8') })
    child.stderr?.on('data', (b: Buffer) => { err += b.toString('utf-8') })
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') finish({ ok: false, reason: friendlyEnoent(opts.bin) })
      else finish({ ok: false, reason: e.message || 'spawn failed' })
    })
    child.on('close', (code) => {
      const text = out.trim() || err.trim()
      if (code === 0 && /Claude Code/i.test(text)) {
        finish({ ok: true, version: text })
      } else if (code === 0 && text) {
        finish({ ok: false, reason: `Got non-Claude-Code output:\n${text}` })
      } else if (code === 0) {
        finish({ ok: false, reason: '`claude --version` produced no output' })
      } else {
        finish({ ok: false, reason: text || `\`claude --version\` exited with code ${code}` })
      }
    })
  })
}

function friendlyEnoent(bin: string): string {
  if (bin === 'wsl.exe') return 'wsl.exe not found — WSL is not installed.'
  if (bin === 'ssh') return 'ssh not found on PATH.'
  return 'No "claude" binary found. Install the Claude Code CLI.'
}
