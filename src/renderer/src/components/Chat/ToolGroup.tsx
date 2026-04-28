import { useState, type ReactNode } from 'react'
import { ChevronRight, ChevronDown, Wrench } from 'lucide-react'

interface Props {
  toolNames: string[]
  children: ReactNode
}

export function ToolGroup({ toolNames, children }: Props) {
  const [expanded, setExpanded] = useState(false)
  const summary = summarize(toolNames)

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-2 text-fg-faint hover:text-fg-muted transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Wrench size={12} />
        <span>{summary}</span>
      </button>
      {expanded && <div className="mt-2 space-y-2 pl-5">{children}</div>}
    </div>
  )
}

// "6 tool calls — Bash ×3 · Edit · Write"
function summarize(names: string[]): string {
  if (!names.length) return 'tool activity'
  const counts = new Map<string, number>()
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1)
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .slice(0, 4)
  const more = counts.size > 4 ? ` …` : ''
  const total = `${names.length} tool call${names.length === 1 ? '' : 's'}`
  return `${total} — ${parts.join(' · ')}${more}`
}
