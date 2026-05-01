// Shared time formatters for the message timestamps that flank user
// and assistant bubbles. We force 24h ("HH:MM") because Electron's
// Chromium reads its own locale, which doesn't track the host OS's 12h
// vs 24h preference reliably across WSL/Windows/macOS/SSH — the result
// was 12h displaying for users on 24h systems. 24h is also the
// conventional choice for developer tooling. The full form in the
// title attribute keeps the rest locale-driven (date format, weekday).

export function formatMessageTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

export function formatMessageTimeFull(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { hour12: false })
}
