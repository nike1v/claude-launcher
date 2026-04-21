interface Props {
  text: string
}

export function UserMessage({ text }: Props): JSX.Element {
  return (
    <div className="flex justify-end">
      <div className="max-w-xl bg-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 whitespace-pre-wrap">
        {text}
      </div>
    </div>
  )
}
