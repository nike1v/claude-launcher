// node-pty is CJS; Node's ESM loader can't pull `spawn` as a named export
// once the bundle is externalized. Default-import the module and pick the
// fn off it manually.
import nodePty from 'node-pty'
const ptySpawn = nodePty.spawn
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HostType, UsageProbeResult } from '../shared/types'
import { parseUsage } from './usage-parser'
import { validateSshHost, validateWslDistro } from './transports/validate-ssh'
import { filteredEnvFor } from './transports/shared'

// Usage probe only spawns claude today (it's claude's /usage panel).
// Hardcoded scrub list mirrors what ClaudeProvider.envScrubList returns
// so a remote claude doesn't inherit the launcher's local OAuth tokens.
const CLAUDE_ENV_SCRUB = ['CLAUDE_CODE_*', 'CLAUDE_RPC_TOKEN'] as const
import { shQuote } from './transports/probe'
import { sshConnectArgs, sshTarget } from './transports/ssh-args'

// Why a PTY: claude's /usage panel is rendered into the TUI by the CLI
// itself — there's no machine-readable flag, no `--json` / `--print` mode
// for it. We spawn claude in an emulated terminal, dismiss the trust dialog
// with a single Enter, type /usage, and screen-scrape the output. That gives
// us the same numbers the user sees in their terminal.
//
// We deliberately don't use --dangerously-skip-permissions: we never run any
// tools, just /usage, so default permissions are fine. The probe folder is
// empty so the trust click has no real effect.

const PROBE_DIR_NAME = '.claude-launcher-probe'

// Time budget for one probe (per env). claude has to start up + auth-check +
// hit the /usage endpoint + render. WSL cold start and SSH RTT both eat into
// this; 20 s is generous but bounded.
const TOTAL_TIMEOUT_MS = 20_000
// Once output stops arriving for this long, we treat /usage as fully
// rendered and parse what's in the buffer.
const STABLE_GAP_MS = 1500
// How long we wait between spawning and sending Enter / typing /usage. Tuned
// to "easily long enough on the slowest realistic setup".
const TRUST_DISMISS_DELAY_MS = 2500
const USAGE_CMD_DELAY_MS = 2500
// PTY output for /usage realistically fits in <100 KiB of escape codes + text.
// 4 MiB is a generous ceiling that protects against a runaway / stuck claude
// streaming until the hard timeout fires.
const MAX_PTY_BUFFER_BYTES = 4 * 1024 * 1024
// PTY geometry. Wide enough that the /usage panel renders without the bars
// wrapping mid-line (which would defeat the regex parser); tall enough that
// the whole panel + a turn of trust-dialog noise fits without scrolling out
// of the buffer before we read it.
const PTY_COLS = 140
const PTY_ROWS = 40

export async function probeUsage(host: HostType): Promise<UsageProbeResult> {
  const cmd = buildCommand(host)
  if (!cmd) return { ok: false, reason: `Unsupported host: ${host.kind}` }

  return new Promise<UsageProbeResult>((resolve) => {
    let buf = ''
    let lastDataAt = Date.now()
    let usageSent = false
    let settled = false

    // All timers / intervals scheduled inside this promise — finish() walks
    // the list and clears every one. Previously only hardTimer + stableTimer
    // were tracked, so the trust-dismiss / usage-send setTimeouts could fire
    // after settle and call .write() on a killed PTY. They no-op via the
    // settled guard, but holding timer handles past resolve is sloppy.
    const timers: (NodeJS.Timeout | NodeJS.Timer)[] = []
    const track = <T extends NodeJS.Timeout | NodeJS.Timer>(t: T): T => { timers.push(t); return t }

    const finish = (r: UsageProbeResult): void => {
      if (settled) return
      settled = true
      for (const t of timers) {
        clearTimeout(t as NodeJS.Timeout)
        clearInterval(t as NodeJS.Timeout)
      }
      try { term.kill() } catch { /* already dead */ }
      resolve(r)
    }

    // Single helper for "we parsed bars successfully" so the three call
    // sites can't drift in shape — alpha.5 shipped a typo here that made
    // the renderer crash on a missing `reading` field.
    const finishOk = (parsed: ReturnType<typeof parseUsage>): void => {
      finish({
        ok: true,
        reading: {
          bars: parsed.bars,
          totalCostUsd: parsed.totalCostUsd,
          totalDurationApi: parsed.totalDurationApi
        }
      })
    }

    let term: ReturnType<typeof ptySpawn>
    try {
      term = ptySpawn(cmd.bin, cmd.args, {
        name: 'xterm-256color',
        cols: PTY_COLS,
        rows: PTY_ROWS,
        cwd: cmd.cwd,
        env: cmd.env
      })
    } catch (e) {
      const reason = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)
      // Console log on the main side so DevTools (Ctrl+Shift+I) shows it
      // even when the modal can't render the long stack trace nicely.
      console.error('[usage-probe] PTY spawn failed:', reason)
      return resolve({ ok: false, reason: `Failed to start PTY: ${reason}` })
    }

    term.onData((d: string) => {
      // Stop accumulating once we've seen plenty — the parser only ever looks
      // at the most recent /usage panel render, so dropping bytes past the cap
      // doesn't lose any signal we'd actually use.
      if (buf.length >= MAX_PTY_BUFFER_BYTES) return
      buf += d
      lastDataAt = Date.now()
    })
    term.onExit(({ exitCode, signal }) => {
      if (settled) return
      // claude exited before we got data — most likely a missing CLI or auth
      // problem. Try to surface whatever ended up in the buffer.
      const parsed = parseUsage(buf)
      if (parsed.bars.length) finishOk(parsed)
      else finish({
        ok: false,
        reason: `claude exited (code=${exitCode ?? '?'}, signal=${signal ?? 'none'}) before /usage rendered`
      })
    })

    // Dismiss the trust dialog, then issue /usage. We don't try to detect
    // whether the dialog actually appeared (already-trusted dirs skip it):
    // sending a stray Enter to the prompt simply submits an empty message
    // which claude ignores — no cost, no prompt to the model.
    track(setTimeout(() => {
      if (settled) return
      term.write('\r')
    }, TRUST_DISMISS_DELAY_MS))

    track(setTimeout(() => {
      if (settled) return
      usageSent = true
      lastDataAt = Date.now()
      term.write('/usage\r')
    }, TRUST_DISMISS_DELAY_MS + USAGE_CMD_DELAY_MS))

    // Stable-bytes detector: once output stops growing for STABLE_GAP_MS
    // *after* /usage was sent, assume it's done rendering and capture.
    track(setInterval(() => {
      if (!usageSent) return
      if (Date.now() - lastDataAt < STABLE_GAP_MS) return
      const parsed = parseUsage(buf)
      if (parsed.bars.length) {
        finishOk(parsed)
      } else {
        // Output is stable but we didn't recognise any bars — keep waiting
        // for a touch longer in case the panel's still painting; the hard
        // timeout will release us.
      }
    }, 500))

    track(setTimeout(() => {
      const parsed = parseUsage(buf)
      if (parsed.bars.length) finishOk(parsed)
      else {
        // Surface a tail of the raw output so the modal shows something
        // actionable instead of just "timed out". Trim aggressively — full
        // PTY captures include lots of cursor-positioning noise.
        const tail = parsed.rawText.replace(/\s+/g, ' ').trim().slice(-400)
        finish({
          ok: false,
          reason: tail
            ? `Timed out before /usage finished rendering. Last output:\n${tail}`
            : 'No output from claude — is the CLI installed and authenticated on this env?'
        })
      }
    }, TOTAL_TIMEOUT_MS))
  })
}

interface PtyCommand {
  bin: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}

const IS_WINDOWS = process.platform === 'win32'

function buildCommand(host: HostType): PtyCommand | null {
  if (host.kind === 'local') {
    const probeDir = join(homedir(), PROBE_DIR_NAME)
    try { mkdirSync(probeDir, { recursive: true }) } catch { /* nbd */ }
    if (IS_WINDOWS) {
      // node-pty on Windows uses CreateProcessW directly, which (unlike
      // child_process.spawn) doesn't honour PATHEXT — passing "claude" with
      // no extension fails as "File not found" because the npm-global shim
      // is `claude.cmd`. Route through cmd.exe so its PATH+PATHEXT search
      // resolves the right shim.
      return {
        bin: 'cmd.exe',
        args: ['/c', 'claude', '--permission-mode', 'default'],
        cwd: probeDir,
        env: process.env
      }
    }
    return {
      bin: 'claude',
      args: ['--permission-mode', 'default'],
      cwd: probeDir,
      env: process.env
    }
  }

  if (host.kind === 'wsl') {
    try { validateWslDistro(host.distro) } catch { return null }
    // PTY mode lets us use a real login bash without the stdin issues that
    // forced us to drop bash from the regular spawn path. -lc sources
    // ~/.profile (where most users put PATH); we explicitly source ~/.bashrc
    // too since some setups keep PATH there (interactive-only). This way
    // the usage probe is self-sufficient — it doesn't depend on the regular
    // path-cache being populated by an earlier session start.
    const inner = `[ -f ~/.bashrc ] && . ~/.bashrc 2>/dev/null; mkdir -p $HOME/${PROBE_DIR_NAME} && cd $HOME/${PROBE_DIR_NAME} && exec claude --permission-mode default`
    return {
      bin: 'wsl.exe',
      args: ['-d', host.distro, '--', 'bash', '-lc', inner],
      cwd: process.cwd(), // wsl.exe ignores Windows-side cwd for the WSL run
      env: filteredEnvFor(CLAUDE_ENV_SCRUB)
    }
  }

  if (host.kind === 'ssh') {
    try { validateSshHost(host) } catch { return null }
    // -tt forces a remote TTY (so /usage's TUI renders); bash -lc + an
    // explicit bashrc source covers both PATH-in-profile and PATH-in-bashrc
    // setups.
    const sshArgs: string[] = ['-tt', ...sshConnectArgs(host), sshTarget(host)]
    const inner = `[ -f ~/.bashrc ] && . ~/.bashrc 2>/dev/null; mkdir -p ~/${PROBE_DIR_NAME} && cd ~/${PROBE_DIR_NAME} && exec claude --permission-mode default`
    sshArgs.push(`bash -lc ${shQuote(inner)}`)
    return {
      // node-pty/Windows needs the explicit .exe (CreateProcessW skips
      // PATHEXT). Windows ships OpenSSH at C:\Windows\System32\OpenSSH —
      // ssh.exe is on the system PATH there.
      bin: IS_WINDOWS ? 'ssh.exe' : 'ssh',
      args: sshArgs,
      cwd: process.cwd(),
      env: filteredEnvFor(CLAUDE_ENV_SCRUB)
    }
  }

  return null
}
