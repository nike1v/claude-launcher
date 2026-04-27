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

export async function probeUsage(host: HostType): Promise<UsageProbeResult> {
  const cmd = buildCommand(host)
  if (!cmd) return { ok: false, reason: `Unsupported host: ${host.kind}` }

  return new Promise<UsageProbeResult>((resolve) => {
    let buf = ''
    let lastDataAt = Date.now()
    let usageSent = false
    let settled = false

    const finish = (r: UsageProbeResult): void => {
      if (settled) return
      settled = true
      clearTimeout(hardTimer)
      clearInterval(stableTimer)
      try { term.kill() } catch { /* already dead */ }
      resolve(r)
    }

    let term: ReturnType<typeof ptySpawn>
    try {
      term = ptySpawn(cmd.bin, cmd.args, {
        name: 'xterm-256color',
        cols: 140,
        rows: 40,
        cwd: cmd.cwd,
        env: cmd.env
      })
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'failed to spawn claude'
      return resolve({ ok: false, reason })
    }

    term.onData((d: string) => {
      buf += d
      lastDataAt = Date.now()
    })
    term.onExit(({ exitCode, signal }) => {
      if (settled) return
      // claude exited before we got data — most likely a missing CLI or auth
      // problem. Try to surface whatever ended up in the buffer.
      const parsed = parseUsage(buf)
      if (parsed.bars.length) finish({ ok: true, reading: { bars: parsed.bars, totalCostUsd: parsed.totalCostUsd, totalDurationApi: parsed.totalDurationApi } })
      else finish({
        ok: false,
        reason: `claude exited (code=${exitCode ?? '?'}, signal=${signal ?? 'none'}) before /usage rendered`
      })
    })

    // Dismiss the trust dialog, then issue /usage. We don't try to detect
    // whether the dialog actually appeared (already-trusted dirs skip it):
    // sending a stray Enter to the prompt simply submits an empty message
    // which claude ignores — no cost, no prompt to the model.
    setTimeout(() => {
      if (settled) return
      term.write('\r')
    }, TRUST_DISMISS_DELAY_MS)

    setTimeout(() => {
      if (settled) return
      usageSent = true
      lastDataAt = Date.now()
      term.write('/usage\r')
    }, TRUST_DISMISS_DELAY_MS + USAGE_CMD_DELAY_MS)

    // Stable-bytes detector: once output stops growing for STABLE_GAP_MS
    // *after* /usage was sent, assume it's done rendering and capture.
    const stableTimer = setInterval(() => {
      if (!usageSent) return
      if (Date.now() - lastDataAt < STABLE_GAP_MS) return
      const parsed = parseUsage(buf)
      if (parsed.bars.length) {
        finish({ ok: true, parsed })
      } else {
        // Output is stable but we didn't recognise any bars — keep waiting
        // for a touch longer in case the panel's still painting; the hard
        // timeout will release us.
      }
    }, 500)

    const hardTimer = setTimeout(() => {
      const parsed = parseUsage(buf)
      if (parsed.bars.length) finish({ ok: true, reading: { bars: parsed.bars, totalCostUsd: parsed.totalCostUsd, totalDurationApi: parsed.totalDurationApi } })
      else finish({
        ok: false,
        reason: parsed.rawText.trim()
          ? `Timed out before /usage finished rendering`
          : 'No output from claude — is the CLI installed and authenticated?'
      })
    }, TOTAL_TIMEOUT_MS)
  })
}

interface PtyCommand {
  bin: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}

function buildCommand(host: HostType): PtyCommand | null {
  if (host.kind === 'local') {
    const probeDir = join(homedir(), PROBE_DIR_NAME)
    try { mkdirSync(probeDir, { recursive: true }) } catch { /* nbd */ }
    return {
      bin: 'claude',
      args: ['--permission-mode', 'default'],
      cwd: probeDir,
      env: process.env
    }
  }

  if (host.kind === 'wsl') {
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
      env: filteredEnv()
    }
  }

  if (host.kind === 'ssh') {
    const target = host.user ? `${host.user}@${host.host}` : host.host
    const sshArgs: string[] = ['-tt']
    if (host.port) sshArgs.push('-p', String(host.port))
    if (host.keyFile) sshArgs.push('-i', host.keyFile)
    sshArgs.push(target)
    // -tt forces a remote TTY (so /usage's TUI renders); bash -lc + an
    // explicit bashrc source covers both PATH-in-profile and PATH-in-bashrc
    // setups.
    const inner = `[ -f ~/.bashrc ] && . ~/.bashrc 2>/dev/null; mkdir -p ~/${PROBE_DIR_NAME} && cd ~/${PROBE_DIR_NAME} && exec claude --permission-mode default`
    sshArgs.push(`bash -lc ${shQ(inner)}`)
    return {
      bin: 'ssh',
      args: sshArgs,
      cwd: process.cwd(),
      env: filteredEnv()
    }
  }

  return null
}

function filteredEnv(): NodeJS.ProcessEnv {
  // Same filter as the spawn transports: keep CLAUDE_CODE_OAUTH_TOKEN out of
  // the child env so the remote/wsl claude uses its own auth, not ours.
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith('CLAUDE_CODE_') && key !== 'CLAUDE_RPC_TOKEN'
    )
  ) as NodeJS.ProcessEnv
}

function shQ(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
