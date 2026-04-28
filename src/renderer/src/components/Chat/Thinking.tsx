import { useState } from 'react'
import { ChevronRight, ChevronDown, Brain } from 'lucide-react'

interface Props {
  text: string
}

export function Thinking({ text }: Props) {
  const [expanded, setExpanded] = useState(false)
  if (!text.trim()) return <></>

  return (
    <div className="text-xs">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-2 text-fg-faint hover:text-fg-muted transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Brain size={12} />
        <span className="italic">thinking</span>
      </button>
      {expanded && (
        <div className="mt-1 pl-5 text-fg-faint italic whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  )
}
