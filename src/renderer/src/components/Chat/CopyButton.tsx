import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface Props {
  text: string
  className?: string
}

export function CopyButton({ text, className = '' }: Props) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // clipboard unavailable — silently no-op
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied' : 'Copy'}
      className={`p-1 rounded text-white/30 hover:text-white/80 hover:bg-white/10 transition-colors ${className}`}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}
