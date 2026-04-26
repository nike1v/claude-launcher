import { CopyButton } from './CopyButton'

interface Props {
  text: string
}

export function UserMessage({ text }: Props): JSX.Element {
  return (
    <div className="group flex justify-end items-start gap-1">
      <CopyButton text={text} className="opacity-0 group-hover:opacity-100 mt-1 shrink-0" />
      <div className="max-w-xl bg-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 whitespace-pre-wrap">
        {text}
      </div>
    </div>
  )
}
