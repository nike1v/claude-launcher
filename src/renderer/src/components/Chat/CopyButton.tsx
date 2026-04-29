import { useEffect, useRef, useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface Props {
  text: string
  className?: string
}

const FEEDBACK_MS = 1500

// Confirmation that survives mouse-leave. Callers wrap the button in
// `opacity-0 group-hover:opacity-100`, so the button is hidden until the
// message is hovered. After a click we want it to stay visible for the
// FEEDBACK_MS window even if the cursor leaves — but Tailwind 4 changed
// the important syntax (was `!opacity-100`, is now `opacity-100!`) and an
// older `!opacity-100` prefix emits no CSS, leaving the parent's
// opacity-0 in charge. Use an inline style for the override: always wins
// regardless of Tailwind version drift, and CSS specificity is moot since
// inline styles trump class-level rules.
export function CopyButton({ text, className = '' }: Props) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), FEEDBACK_MS)
    } catch {
      // clipboard unavailable — silently no-op
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied' : 'Copy'}
      style={copied ? { opacity: 1 } : undefined}
      className={`inline-flex items-center gap-1 p-1 rounded transition-colors ${
        copied
          ? 'text-success'
          : 'text-fg-faint hover:text-fg hover:bg-elevated'
      } ${className}`}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied && <span className="text-[10px] font-medium">Copied</span>}
    </button>
  )
}
