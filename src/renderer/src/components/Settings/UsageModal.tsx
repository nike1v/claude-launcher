import { useEffect, useState } from 'react'
import { X, RefreshCw } from 'lucide-react'
import type { Environment, UsageProbeResult, UsageBar } from '../../../../shared/types'
import { probeEnvironmentUsage } from '../../ipc/bridge'
import { Modal } from '../Modal'
import { ErrorBoundary } from '../ErrorBoundary'

interface Props {
  env: Environment
  onClose: () => void
}

type LoadingState = { loading: true }
type ModalState = UsageProbeResult | LoadingState | null

// Type predicate so TS can narrow `state` properly between branches —
// without it the `'loading' in state` inline check leaves UsageProbeResult
// fields undiscriminated past the early return.
function isLoading(s: ModalState): s is LoadingState {
  return s !== null && 'loading' in s && s.loading === true
}

// Renders the subscription / weekly usage bars for one environment, scraped
// from claude's interactive `/usage` view via a one-shot PTY probe in the
// main process. The probe takes a few seconds (claude startup + auth + API
// round-trip), so we open the modal in a loading state and resolve once the
// scraper returns.
export function UsageModal({ env, onClose }: Props) {
  const [state, setState] = useState<ModalState>({ loading: true })

  const fetch = (): void => {
    setState({ loading: true })
    probeEnvironmentUsage(env.config).then(setState).catch(err => {
      setState({ ok: false, reason: err instanceof Error ? err.message : 'usage probe failed' })
    })
  }

  useEffect(() => { fetch() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [env.id])

  return (
    <Modal onClose={onClose} panelClassName="bg-panel border border-divider rounded-lg w-[28rem] max-h-[90vh] overflow-hidden flex flex-col">
      <>
        <div className="flex items-center justify-between px-5 py-4 border-b border-divider">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">Usage · {env.name}</h2>
            <p className="text-[11px] text-fg-faint mt-0.5">
              Scraped from <code className="text-fg-muted">claude /usage</code>
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={fetch}
              disabled={isLoading(state)}
              title="Refresh"
              className="p-1.5 rounded text-fg-faint hover:text-fg hover:bg-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw size={14} className={isLoading(state) ? 'animate-spin' : ''} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded text-fg-faint hover:text-fg hover:bg-elevated">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <ErrorBoundary
            fallback={err => (
              <div className="text-xs text-red-300/80 whitespace-pre-wrap break-words">
                Render error in usage modal:{'\n'}{err.message}
              </div>
            )}
          >
            <UsageBody state={state} />
          </ErrorBoundary>
        </div>
      </>
    </Modal>
  )
}

function UsageBody({ state }: { state: ModalState }) {
  if (state === null || isLoading(state)) {
    return (
      <div className="space-y-3">
        <SkeletonBar />
        <SkeletonBar />
        <SkeletonBar />
        <p className="text-xs text-fg-faint mt-4">
          Spawning claude on this environment to read /usage. Takes a few seconds…
        </p>
      </div>
    )
  }

  if (!state.ok) {
    return (
      <div className="text-xs text-red-300/80 whitespace-pre-wrap break-words">
        {state.reason}
      </div>
    )
  }

  // Defensive — alpha.5 shipped with a malformed { ok: true } payload that
  // had no `reading` field, which crashed the modal. Treat a missing /
  // empty reading as "layout unrecognised" rather than dereferencing it.
  const reading = state.reading
  if (!reading || !Array.isArray(reading.bars) || reading.bars.length === 0) {
    return (
      <div className="text-xs text-fg-faint">
        claude responded but no usage bars were recognised. The /usage layout may
        have changed; try again, or check the terminal directly.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {reading.bars.map(bar => <BarRow key={bar.key} bar={bar} />)}
      {reading.totalCostUsd && (
        <div className="text-[11px] text-fg-faint pt-3 border-t border-divider">
          Session cost: ${reading.totalCostUsd}
          {reading.totalDurationApi && <> · API time: {reading.totalDurationApi}</>}
        </div>
      )}
    </div>
  )
}

function BarRow({ bar }: { bar: UsageBar }) {
  const tone =
    bar.percent >= 90 ? 'bg-red-400'
    : bar.percent >= 75 ? 'bg-amber-400'
    : 'bg-blue-400/70'
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-xs text-fg">{bar.label}</span>
        <span className="text-xs tabular-nums text-fg-muted">{bar.percent}%</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-elevated overflow-hidden">
        <div className={`absolute inset-y-0 left-0 ${tone} rounded-full transition-[width] duration-300`} style={{ width: `${bar.percent}%` }} />
      </div>
      {bar.resetsAt && <p className="text-[11px] text-fg-faint mt-1">Resets {bar.resetsAt}</p>}
    </div>
  )
}

function SkeletonBar() {
  return (
    <div>
      <div className="h-3 w-32 bg-elevated rounded mb-1.5 animate-pulse" />
      <div className="h-1.5 w-full bg-elevated rounded-full animate-pulse" />
    </div>
  )
}
