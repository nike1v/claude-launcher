import { useSessionsStore } from '../../store/sessions'
import { useProjectsStore } from '../../store/projects'
import { useEnvironmentsStore } from '../../store/environments'
import { useMessagesStore } from '../../store/messages'
import { ContextMeter } from './ContextMeter'
import type { NormalizedEvent, TokenUsage } from '../../../../shared/events'

const EMPTY: readonly never[] = []

export function StatusBar() {
  // Selectors keep StatusBar from re-rendering on every unrelated mutation
  // anywhere in the app (sidebar tab moves, message arrivals on background
  // sessions, etc.). It only cares about the active session's data.
  const activeSessionId = useSessionsStore(s => s.activeSessionId)
  const session = useSessionsStore(s => activeSessionId ? s.sessions[activeSessionId] : null)
  const project = useProjectsStore(s => session ? s.projects.find(p => p.id === session.projectId) ?? null : null)
  const env = useEnvironmentsStore(s => project ? s.environments.find(e => e.id === project.environmentId) ?? null : null)
  const events = useMessagesStore(s => activeSessionId ? (s.eventsBySession[activeSessionId] ?? EMPTY) : EMPTY)
  const sessionStart = events.find(e => e.kind === 'session.started')
  const cwd = sessionStart?.kind === 'session.started' ? sessionStart.cwd : undefined
  const eventModel = sessionStart?.kind === 'session.started' ? sessionStart.model : undefined

  // session.started isn't recorded to the JSONL transcript, so a freshly
  // restored tab has no session.started yet. Fall back to the model we
  // cached on the previous run (persisted via tabs.json), then to the
  // project's configured override.
  const modelLabel = eventModel ?? session?.lastModel ?? project?.model ?? null
  const ctx = computeContextFill(events, modelLabel ?? undefined, session?.lastContextWindow)

  const hostLabel = env
    ? env.config.kind === 'local'
      ? 'Local'
      : env.config.kind === 'wsl'
      ? `WSL · ${env.config.distro}`
      : `SSH · ${env.config.host}`
    : ''

  return (
    <div className="h-7 border-t border-divider flex items-center px-3 gap-3 text-xs text-fg-faint shrink-0 overflow-hidden">
      {session && (
        <>
          {/* Status dot moved to the project list / tab title — the bottom
              bar is now strictly host / cwd / context / model. */}
          <span className="shrink-0">{hostLabel}</span>
          {(cwd ?? project?.path) && (
            <span className="text-fg-faint truncate min-w-0">{cwd ?? project?.path}</span>
          )}
          <div className="ml-auto flex items-center gap-3 shrink-0">
            {ctx && <ContextMeter used={ctx.used} total={ctx.total} />}
            {modelLabel && <span className="text-fg-faint">{modelLabel}</span>}
          </div>
        </>
      )}
    </div>
  )
}

function computeContextFill(
  events: readonly NormalizedEvent[],
  model: string | undefined,
  cachedTotal: number | undefined
): { used: number; total: number } | null {
  // Walk backwards: the most recent tokenUsage.updated tells us both the
  // input context size for the latest assistant call and (when claude
  // emits a result) the contextWindow total.
  let used: number | null = null
  let totalFromEvent: number | null = null
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev.kind !== 'tokenUsage.updated') continue
    const u: TokenUsage = ev.usage
    if (used === null && (u.inputTokens !== undefined || u.cachedInputTokens !== undefined)) {
      used = (u.inputTokens ?? 0) + (u.cachedInputTokens ?? 0)
    }
    if (totalFromEvent === null && u.contextWindow !== undefined) {
      totalFromEvent = u.contextWindow
    }
    if (used !== null && totalFromEvent !== null) break
  }
  // If we don't even have a model id (or a cached total from a previous
  // run) we can't pick a sensible total, so suppress the meter entirely.
  // Otherwise show the bar — even at 0% used — so the user always sees
  // the budget.
  if (used === null && !model && !cachedTotal) return null
  const total = totalFromEvent ?? cachedTotal ?? defaultContextWindow(model, used ?? 0)
  return { used: used ?? 0, total }
}

// Fall back when no result has supplied contextWindow yet (e.g. mid-turn
// or right after restoring a session). The "[1m]" model id signals the
// 1M context tier explicitly; otherwise infer the tier from observed
// usage — if a past turn already consumed more than 200K, the session
// must be on a 1M-context model.
function defaultContextWindow(model: string | undefined, observedUsed: number): number {
  if (model && /\[1m\]/i.test(model)) return 1_000_000
  if (observedUsed > 200_000) return 1_000_000
  return 200_000
}
