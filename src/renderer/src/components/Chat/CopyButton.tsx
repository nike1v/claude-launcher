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

  const handleCopy = () => {
    // electron.clipboard via preload, NOT navigator.clipboard. The browser
    // API goes through Chromium's permission gate, which our deny-all
    // permission handler from v0.4.4 refuses for `clipboard-sanitized-write`
    // — so clicks on this button were a no-op in production despite the
    // (now-fixed) visual feedback. The native module is sync and never
    // fails for our use case.
    window.electronAPI.copyText(text)
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), FEEDBACK_MS)
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
