import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'

interface Props {
  id: string
  name: string
  input: unknown
  sessionId: string
}

export function ToolUse({ id, name, input, sessionId }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-white/10 rounded-lg overflow-hidden text-xs">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-2 w-full px-3 py-2 text-white/50 hover:text-white/70 hover:bg-white/5 transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-mono">{name}</span>
      </button>
      {expanded && (
        <div className="px-3 py-2 bg-black/20 border-t border-white/10">
          <pre className="text-white/60 text-xs overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
