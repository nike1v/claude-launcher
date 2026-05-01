// Shared time formatters for the message timestamps that flank user
// and assistant bubbles. Locale-driven so a user on a 12h locale sees
// "2:45 PM" and a 24h locale sees "14:45". The full-precision form
// goes into the title attribute so hovering shows the date too.

export function formatMessageTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatMessageTimeFull(ms: number): string {
  return new Date(ms).toLocaleString()
}
