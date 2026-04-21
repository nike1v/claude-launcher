import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  text: string
}

export function AssistantMessage({ text }: Props): JSX.Element {
  return (
    <div className="max-w-3xl">
      <div className="text-xs text-white/30 mb-1">claude</div>
      <div className="prose prose-invert prose-sm max-w-none text-[#e5e5e5]
        prose-code:bg-white/10 prose-code:px-1 prose-code:rounded prose-code:text-xs
        prose-pre:bg-[#111] prose-pre:border prose-pre:border-white/10">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    </div>
  )
}
