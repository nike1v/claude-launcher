import { spawn } from 'node:child_process'

// Unified `claude --version` probe runner. Replaces the v0.4.x split
// between probe.ts (local: just a version check) and path-probe.ts
// (wsl/ssh: login-shell PATH extraction + version check). The two were
// 90 % identical — same spawn-with-timeout wrapper, same ENOENT
// translation — and only differed in whether they expected the wrapper
// script's PATH-marker line in stdout. Now there's one runner that
// always parses line-by-line; callers that don't supply the wrapper
// script just don't get a `path` back.

const PATH_MARKER = '__CL_PATH='

// One-shot bash script: source the user's login + bashrc PATH, print it
// on a dedicated marker line, then run `<bin> --version` so the same
// probe validates the binary. Used by WSL and SSH transports where
// wsl.exe / a non-interactive ssh shell otherwise miss profile-only
// PATH additions (~/.local/bin via .profile, npm-global, asdf shims,
// mise, etc.). `printf` (not `echo`) so unusual PATH characters survive
// intact, and we guard the bashrc source with `[ -f ~/.bashrc ]` to
// avoid noise on hosts that don't have one.
//
// `bin` MUST be a known provider binary name ('claude', 'codex', …) —
// not user input. It's interpolated unquoted so a malicious value
// would be a shell-injection sink. ProviderRegistry hands these out;
// no untrusted path reaches here.
export function probeScript(bin: string): string {
  return `[ -f ~/.bashrc ] && . ~/.bashrc 2>/dev/null; printf '${PATH_MARKER}%s\\n' "$PATH"; ${bin} --version`
}

interface RunOpts {
  bin: string
  args: string[]
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
  // Regex matched against any line of stdout/stderr to recognize a
  // valid version banner. Without a match we treat the response as
  // "wrong binary on PATH" so the user gets a clear error instead of
  // a session that hangs waiting for stream-json from `cat`.
  versionLine?: RegExp
}

// Internal shape used by runShellProbe — note the difference from the
// transport-level `ProbeResult` (in ./types) which is a strict
// discriminated union without an optional `path`. Each transport's
// public probe() converts a ShellProbeResult to that strict shape.
export interface ShellProbeResult {
  ok: boolean
  version?: string
  // Only populated when stdout contains the `__CL_PATH=…` marker line —
  // i.e. when the caller used probeScript() as the remote payload.
  // Local-side probes (`claude --version` directly) leave this undefined.
  path?: string
  reason?: string
}

export function runShellProbe(opts: RunOpts): Promise<ShellProbeResult> {
  const timeout = opts.timeoutMs ?? 8000
  return new Promise<ShellProbeResult>((resolve) => {
    let out = ''
    let err = ''
    let settled = false
    const finish = (r: ShellProbeResult): void => {
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
      finish({ ok: false, reason: 'version probe timed out' })
    }, timeout) as ReturnType<typeof setTimeout>
    child.stdout?.on('data', (b: Buffer) => { out += b.toString('utf-8') })
    child.stderr?.on('data', (b: Buffer) => { err += b.toString('utf-8') })
    child.on('error', (e: NodeJS.ErrnoException) => {
      finish({ ok: false, reason: friendlyEnoent(opts.bin, e) })
    })
    child.on('close', (code) => {
      const lines = (out + '\n' + err).split('\n')
      const pathLine = lines.find(l => l.startsWith(PATH_MARKER))
      const path = pathLine ? pathLine.slice(PATH_MARKER.length).trim() : undefined
      const versionRe = opts.versionLine ?? /./
      const versionLine = lines.find(l => versionRe.test(l) && !l.startsWith(PATH_MARKER))
      if (code === 0 && versionLine) {
        finish({ ok: true, version: versionLine.trim(), path })
      } else if (code === 0) {
        const text = (out + err).trim()
        finish({
          ok: false,
          reason: text ? `Got unexpected version output:\n${text}` : 'version probe produced no output',
          path
        })
      } else {
        const text = err.trim() || out.trim() || `version probe exited with code ${code}`
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
    return `Binary "${bin}" not found on PATH. Install the corresponding CLI.`
  }
  return e.message || 'spawn failed'
}

// POSIX single-quote escape for embedding strings inside `'...'` in remote
// shell scripts (used to wrap probeScript() for ssh's bash -lc invocation,
// and to defang user-supplied paths handed to remote `sh -c`).
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
