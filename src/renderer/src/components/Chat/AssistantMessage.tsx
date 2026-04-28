import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CopyButton } from './CopyButton'

interface Props {
  text: string
}

export function AssistantMessage({ text }: Props) {
  return (
    <div className="group max-w-3xl">
      <div className="flex items-center gap-1 mb-1">
        <span className="text-xs text-fg-faint">claude</span>
        <CopyButton text={text} className="opacity-0 group-hover:opacity-100" />
      </div>
      <div className="prose prose-invert prose-sm max-w-none text-fg
        prose-code:bg-elevated prose-code:px-1 prose-code:rounded prose-code:text-xs
        prose-pre:bg-app prose-pre:border prose-pre:border-divider">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    </div>
  )
}
