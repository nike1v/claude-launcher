interface Props {
  used: number
  total: number
}

// Compact context-fill indicator for the status bar:
//   [▮▮▮▮░░░░░░] 23% · 47K / 200K
// Color shifts as we approach the compact threshold so the user has a
// visual signal that they should /compact or wrap up the conversation.
export function ContextMeter({ used, total }: Props) {
  const ratio = total > 0 ? Math.min(1, used / total) : 0
  const percent = Math.round(ratio * 100)

  const tone =
    ratio >= 0.9 ? 'bg-red-400'
    : ratio >= 0.75 ? 'bg-amber-400'
    : 'bg-fg-faint'

  const textTone =
    ratio >= 0.9 ? 'text-red-300/80'
    : ratio >= 0.75 ? 'text-amber-300/80'
    : 'text-fg-faint'

  return (
    <span className={`flex items-center gap-1.5 ${textTone}`} title={`${used.toLocaleString()} / ${total.toLocaleString()} tokens`}>
      <span className="relative inline-block w-12 h-1 rounded-full bg-elevated overflow-hidden">
        <span
          className={`absolute inset-y-0 left-0 ${tone} transition-[width] duration-300`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="tabular-nums">
        {percent}% · {formatTokens(used)} / {formatTokens(total)}
      </span>
    </span>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}
