import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import type { ToolResultBlock } from '../../../../shared/types'

interface Props {
  id: string
  name: string
  input: unknown
  sessionId: string
  result?: ToolResultBlock
}

export function ToolUse({ name, input, result }: Props) {
  const [expanded, setExpanded] = useState(false)
  const summary = summarizeInput(name, input)
  const resultText = result ? extractResultText(result) : null
  const isError = result?.is_error === true

  return (
    <div className={`border rounded-lg overflow-hidden text-xs ${isError ? 'border-red-500/30' : 'border-divider'}`}>
      <button
        onClick={() => setExpanded(e => !e)}
        className={`flex items-center gap-2 w-full px-3 py-2 transition-colors text-left ${
          isError
            ? 'text-red-300/80 hover:text-red-300 hover:bg-red-500/5'
            : 'text-fg-faint hover:text-fg-muted hover:bg-elevated'
        }`}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-mono">{name}</span>
        {summary && <span className="font-mono text-fg-faint truncate">{summary}</span>}
        {!result && (
          <span className="ml-auto text-fg-faint italic shrink-0">running…</span>
        )}
      </button>
      {expanded && (
        <div className="bg-black/20 border-t border-divider">
          <div className="px-3 py-2">
            <div className="text-fg-faint mb-1">input</div>
            <pre className="text-fg-muted overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          {resultText !== null && (
            <div className="px-3 py-2 border-t border-divider">
              <div className="text-fg-faint mb-1">{isError ? 'error' : 'result'}</div>
              <pre className={`overflow-x-auto whitespace-pre-wrap ${isError ? 'text-red-300/80' : 'text-fg-muted'}`}>
                {resultText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function summarizeInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const obj = input as Record<string, unknown>
  const lower = name.toLowerCase()

  if (lower === 'bash' && typeof obj.command === 'string') {
    return truncate(obj.command, 120)
  }
  if (typeof obj.file_path === 'string') return truncate(obj.file_path, 120)
  if (typeof obj.path === 'string') return truncate(obj.path, 120)
  if (typeof obj.pattern === 'string') return truncate(obj.pattern, 120)
  if (typeof obj.url === 'string') return truncate(obj.url, 120)
  if (typeof obj.query === 'string') return truncate(obj.query, 120)
  if (typeof obj.description === 'string') return truncate(obj.description, 120)
  return ''
}

function extractResultText(result: ToolResultBlock): string {
  if (typeof result.content === 'string') return result.content
  return result.content
    .map(b => (b.type === 'text' ? b.text : ''))
    .filter(Boolean)
    .join('\n')
}

function truncate(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim()
  return oneLine.length > n ? oneLine.slice(0, n - 1) + '…' : oneLine
}
