import { useSessionsStore } from '../../store/sessions'
import { useProjectsStore } from '../../store/projects'
import { useMessagesStore } from '../../store/messages'
import { ContextMeter } from './ContextMeter'
import type { AssistantEvent, InitEvent, ResultEvent } from '../../../../shared/types'

const STATUS_COLOR: Record<string, string> = {
  starting: 'bg-yellow-400',
  ready: 'bg-green-400',
  busy: 'bg-blue-400',
  error: 'bg-red-400',
  closed: 'bg-white/20'
}

export function StatusBar(): JSX.Element {
  const { sessions, activeSessionId } = useSessionsStore()
  const { projects } = useProjectsStore()
  const { messagesBySession } = useMessagesStore()

  const session = activeSessionId ? sessions[activeSessionId] : null
  const project = session ? projects.find(p => p.id === session.projectId) : null

  const messages = activeSessionId ? (messagesBySession[activeSessionId] ?? []) : []
  const initEvent = messages
    .map(m => m.event)
    .find((e): e is InitEvent => e.type === 'system' && (e as { subtype?: string }).subtype === 'init')

  // The init event is a runtime stream-json event and isn't recorded to the
  // JSONL transcript, so a freshly restored tab has no init yet. Fall back to
  // the model the project was configured with so the user still sees something.
  const modelLabel = initEvent?.model ?? project?.model ?? null
  const ctx = computeContextFill(messages.map(m => m.event), modelLabel ?? undefined)

  const hostLabel = project
    ? project.host.kind === 'wsl'
      ? `WSL · ${project.host.distro}`
      : `SSH · ${project.host.host}`
    : ''

  return (
    <div className="h-7 border-t border-white/10 flex items-center px-3 gap-3 text-xs text-white/30 shrink-0 overflow-hidden">
      {session && (
        <>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLOR[session.status] ?? 'bg-white/20'}`} />
          <span className="shrink-0">{hostLabel}</span>
          {(initEvent?.cwd ?? project?.path) && (
            <span className="text-white/20 truncate min-w-0">{initEvent?.cwd ?? project?.path}</span>
          )}
          <div className="ml-auto flex items-center gap-3 shrink-0">
            {ctx && <ContextMeter used={ctx.used} total={ctx.total} />}
            {modelLabel && <span className="text-white/20">{modelLabel}</span>}
          </div>
        </>
      )}
    </div>
  )
}

function computeContextFill(
  events: ReadonlyArray<{ type: string }>,
  model: string | undefined
): { used: number; total: number } | null {
  // Walk backwards: latest assistant.usage tells us the input context size
  // for the most recent turn (input + cache_read + cache_creation).
  let used: number | null = null
  let totalFromResult: number | null = null
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i] as AssistantEvent | ResultEvent | { type: string }
    if (used === null && ev.type === 'assistant') {
      const usage = (ev as AssistantEvent).message.usage
      if (usage) {
        used =
          (usage.input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0)
      }
    }
    if (totalFromResult === null && ev.type === 'result') {
      const mu = (ev as ResultEvent).modelUsage
      if (mu) {
        for (const v of Object.values(mu)) {
          if (v?.contextWindow) { totalFromResult = v.contextWindow; break }
        }
      }
    }
    if (used !== null && totalFromResult !== null) break
  }
  // If we don't even have a model id we can't pick a sensible default total,
  // so suppress the meter entirely. Otherwise show the bar — even at 0% used
  // — so the user always sees the budget.
  if (used === null && !model) return null
  const total = totalFromResult ?? defaultContextWindow(model, used ?? 0)
  return { used: used ?? 0, total }
}

// Fall back when no result event has supplied modelUsage yet (e.g. mid-turn
// or right after restoring a session). The "[1m]" model id signals the 1M
// context tier explicitly; otherwise infer the tier from observed usage —
// if a past turn already consumed more than 200K, the session must be on a
// 1M-context model.
function defaultContextWindow(model: string | undefined, observedUsed: number): number {
  if (model && /\[1m\]/i.test(model)) return 1_000_000
  if (observedUsed > 200_000) return 1_000_000
  return 200_000
}
