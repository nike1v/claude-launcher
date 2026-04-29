import { useEffect, useRef, useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface Props {
  text: string
  className?: string
}

const FEEDBACK_MS = 1500

// Confirmation that survives mouse-leave: callers wrap the button in a
// `opacity-0 group-hover:opacity-100` container so the button appears only
// while the message is hovered. After a click the user often moves their
// mouse — without `!opacity-100` here the success icon would vanish before
// they could see it. The `!` (Tailwind important) wins over the parent's
// opacity-0 for the FEEDBACK_MS window.
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
      className={`inline-flex items-center gap-1 p-1 rounded transition-colors ${
        copied
          ? '!opacity-100 text-success'
          : 'text-fg-faint hover:text-fg hover:bg-elevated'
      } ${className}`}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied && <span className="text-[10px] font-medium">Copied</span>}
    </button>
  )
}
