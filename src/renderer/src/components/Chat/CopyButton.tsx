import { useEffect, useRef, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { copyText } from '../../ipc/bridge'

interface Props {
  text: string
  className?: string
}

const FEEDBACK_MS = 1500

// Callers wrap this button in `opacity-0 group-hover:opacity-100`, so it's
// hidden until the message is hovered. After a click we want the success
// state to stay visible for FEEDBACK_MS even if the cursor leaves — the
// inline `style={{ opacity: 1 }}` below wins by CSS specificity, no matter
// what Tailwind version generates for the parent's opacity utility.
export function CopyButton({ text, className = '' }: Props) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleCopy = () => {
    copyText(text)
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
