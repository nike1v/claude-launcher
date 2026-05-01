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
