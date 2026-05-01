import { app } from 'electron'
import { existsSync, renameSync, statSync, appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Append-only ACP traffic log for debugging cursor / opencode session
// failures. Lives in the Electron userData dir so the user can find
// it predictably across platforms — on Windows that's
// %APPDATA%/Claude Launcher/acp-debug.log.
//
// Why a file instead of console.log: in production builds main-process
// stdout goes to nowhere visible to the user. A file they can locate
// and paste back to us is what unblocks remote debugging.
//
// Size guard: at MAX_BYTES we rotate to .old and start fresh. One
// rotation is enough — we don't need a multi-day retention, just the
// most recent failing turn.

const MAX_BYTES = 1_000_000

let cachedPath: string | null = null
function logPath(): string | null {
  if (cachedPath) return cachedPath
  try {
    cachedPath = join(app.getPath('userData'), 'acp-debug.log')
    return cachedPath
  } catch {
    return null
  }
}

export function acpDebugLogPath(): string | null {
  return logPath()
}

export function acpLog(direction: 'rx' | 'tx', sessionId: string, provider: string, line: string): void {
  const path = logPath()
  if (!path) return
  const stamp = new Date().toISOString()
  // Trim each line to a sane length so a giant tool_result payload
  // doesn't blow the cap in one write — the wire protocol info we need
  // is at the start of the line anyway (method / id / first content
  // chunk).
  const trimmed = line.length > 4_000 ? line.slice(0, 4_000) + '…(truncated)' : line
  const entry = `${stamp} ${direction} ${provider} ${sessionId.slice(0, 8)} ${trimmed.replace(/\n+$/, '')}\n`
  try {
    if (existsSync(path) && statSync(path).size + entry.length > MAX_BYTES) {
      renameSync(path, `${path}.old`)
    }
    if (!existsSync(path)) writeFileSync(path, '')
    appendFileSync(path, entry)
  } catch {
    /* swallow — debug log shouldn't break the session */
  }
}
