import { useState } from 'react'
import { ChevronRight, ChevronDown, Brain } from 'lucide-react'

interface Props {
  text: string
}

export function Thinking({ text }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  if (!text.trim()) return <></>

  return (
    <div className="text-xs">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-2 text-white/30 hover:text-white/60 transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Brain size={12} />
        <span className="italic">thinking</span>
      </button>
      {expanded && (
        <div className="mt-1 pl-5 text-white/50 italic whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  )
}
