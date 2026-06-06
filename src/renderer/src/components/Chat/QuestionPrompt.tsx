import { memo, useState } from 'react'
import { respondUserInput } from '../../ipc/bridge'
import type { UserInputQuestion } from '../../../../shared/events'

interface Props {
  sessionId: string
  requestId: string
  questions: readonly UserInputQuestion[]
  resolved?: boolean
}

// claude's AskUserQuestion, rendered as an interactive prompt. The choice is
// routed back through the question's can_use_tool gate (see ClaudeAdapter)
// because stream-json mode has no structured answer channel. Single-select
// questions store one label; multiSelect store an array; free-text store the
// typed string. All keyed by question id.
type Selection = Record<string, string | string[]>

export const QuestionPrompt = memo(function QuestionPrompt({ sessionId, requestId, questions, resolved }: Props) {
  const [selection, setSelection] = useState<Selection>({})

  const pickSingle = (qid: string, label: string): void =>
    setSelection(s => ({ ...s, [qid]: label }))

  const toggleMulti = (qid: string, label: string): void =>
    setSelection(s => {
      const cur = Array.isArray(s[qid]) ? (s[qid] as string[]) : []
      return { ...s, [qid]: cur.includes(label) ? cur.filter(l => l !== label) : [...cur, label] }
    })

  const setText = (qid: string, value: string): void =>
    setSelection(s => ({ ...s, [qid]: value }))

  const isChosen = (qid: string, label: string): boolean => {
    const v = selection[qid]
    return Array.isArray(v) ? v.includes(label) : v === label
  }

  return (
    <div className="border border-accent/40 bg-accent/10 rounded-lg px-4 py-3 space-y-3">
      <p className="text-xs text-accent font-medium">Question</p>
      {questions.map(q => (
        <div key={q.id} className="space-y-1.5">
          {q.header && <p className="text-xs text-fg-faint uppercase tracking-wide">{q.header}</p>}
          <p className="text-sm text-fg">{q.prompt}</p>
          {q.kind === 'choice' && q.choices ? (
            <div className="flex flex-wrap gap-2">
              {q.choices.map(label => (
                <button
                  key={label}
                  disabled={resolved}
                  onClick={() => (q.multiSelect ? toggleMulti(q.id, label) : pickSingle(q.id, label))}
                  className={
                    isChosen(q.id, label)
                      ? 'px-3 py-1.5 bg-accent/20 border border-accent/60 text-accent text-xs rounded transition-colors'
                      : 'px-3 py-1.5 bg-elevated hover:bg-panel border border-divider text-fg text-xs rounded transition-colors disabled:opacity-50'
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <input
              type="text"
              disabled={resolved}
              value={typeof selection[q.id] === 'string' ? (selection[q.id] as string) : ''}
              onChange={e => setText(q.id, e.target.value)}
              className="w-full bg-elevated border border-divider rounded px-2 py-1.5 text-sm text-fg placeholder-fg-faint focus:outline-none focus:border-accent"
            />
          )}
        </div>
      ))}
      {resolved ? (
        <p className="text-xs text-fg-faint italic">answered</p>
      ) : (
        <button
          onClick={() => respondUserInput(sessionId, requestId, selection)}
          className="px-3 py-1.5 bg-accent/20 hover:bg-accent/40 border border-accent/60 text-accent text-xs rounded transition-colors"
        >
          Submit
        </button>
      )}
    </div>
  )
})
