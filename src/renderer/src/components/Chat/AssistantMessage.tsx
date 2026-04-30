import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Sparkles } from 'lucide-react'
import { CopyButton } from './CopyButton'

interface Props {
  text: string
}

// memo'd: deriveItems hands back a fresh RenderedItem object every
// render of MessageList, but the leaf `text` value rarely changes.
// Without memo this component (and its ReactMarkdown subtree, which is
// expensive) re-renders on every event arrival in the same session.
export const AssistantMessage = memo(function AssistantMessage({ text }: Props) {
  return (
    // Two-column message grid: a small accent-tinted "claude" badge
    // anchors the left edge, the markdown body sits in the right column.
    // Reads as a distinct message rather than just floating prose, and
    // matches how Claude.ai / Cursor render assistant turns.
    <div className="group flex gap-3 max-w-3xl">
      <span
        className="shrink-0 w-6 h-6 rounded-full bg-accent/15 text-accent flex items-center justify-center mt-0.5"
        aria-hidden="true"
      >
        <Sparkles size={12} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 mb-1">
          <span className="text-xs font-medium text-fg-muted">claude</span>
          <CopyButton text={text} className="opacity-0 group-hover:opacity-100" />
        </div>
        <div className="prose prose-invert prose-sm max-w-none text-fg
          prose-code:bg-elevated prose-code:px-1 prose-code:rounded prose-code:text-xs
          prose-pre:bg-app prose-pre:border prose-pre:border-divider">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      </div>
    </div>
  )
})
