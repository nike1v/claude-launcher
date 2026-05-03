import type { ClockFormat } from '../store/theme'

// Shared time formatters for the message timestamps that flank user
// and assistant bubbles. Electron's Chromium reads its own locale and
// doesn't track the host OS's 12h vs 24h preference reliably across
// WSL/Windows/macOS/SSH, so the format is driven by an explicit user
// setting (themeStore.clockFormat) rather than auto-detection. The full
// form in the title attribute follows the same setting; the date part
// stays locale-driven.

export function formatMessageTime(ms: number, clockFormat: ClockFormat): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: clockFormat === '12h'
  })
}

export function formatMessageTimeFull(ms: number, clockFormat: ClockFormat): string {
  return new Date(ms).toLocaleString(undefined, { hour12: clockFormat === '12h' })
}

// Elapsed-duration formatter for the in-flight spinner copy ("X is
// thinking… 47s" / "no activity for 2m 13s"). Shows whole seconds
// under a minute, then `Xm Ys` once we cross 60 s. Negative or NaN
// inputs collapse to "0s" so a clock-skewed lastEventAt can't render
// "-3s".
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s'
  const totalSec = Math.floor(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}m ${s}s`
}
