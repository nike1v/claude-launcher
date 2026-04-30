import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react'
import type { HostType } from '../../../../shared/types'
import type { ProviderKind } from '../../../../shared/events'
import { probeEnvironment } from '../../ipc/bridge'

export type ProbeState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok'; version: string }
  | { kind: 'error'; reason: string }

interface Props {
  config: HostType
  // Provider whose binary we're probing on this env. Defaults to claude
  // for legacy callers that haven't been updated yet.
  providerKind?: ProviderKind
  // Bumping this re-runs the probe. Used to trigger a recheck after an
  // env edit without unmounting the row.
  rev?: number
  // Compact: chip + tooltip only, no Recheck button. Used in lists.
  compact?: boolean
  // Lets parents react to probe state — used by EnvironmentForm to gate
  // its submit on a successful probe.
  onResult?: (state: ProbeState) => void
}

export function EnvironmentStatus({ config, providerKind, rev = 0, compact = false, onResult }: Props) {
  const [state, setState] = useState<ProbeState>({ kind: 'idle' })
  const [trigger, setTrigger] = useState(0)

  useEffect(() => {
    let cancelled = false
    const next: ProbeState = { kind: 'checking' }
    setState(next)
    onResult?.(next)
    probeEnvironment(config, providerKind).then(result => {
      if (cancelled) return
      const settled: ProbeState = result.ok
        ? { kind: 'ok', version: result.version }
        : { kind: 'error', reason: result.reason }
      setState(settled)
      onResult?.(settled)
    })
    return () => { cancelled = true }
  }, [JSON.stringify(config), providerKind, rev, trigger])

  const tooltip =
    state.kind === 'ok' ? state.version
    : state.kind === 'error' ? state.reason
    : state.kind === 'checking' ? 'Checking…'
    : ''

  const chip = (
    <span title={tooltip} className="inline-flex items-center gap-1 text-xs">
      {state.kind === 'checking' && <Loader2 size={12} className="animate-spin text-fg-faint" />}
      {state.kind === 'ok' && <CheckCircle2 size={12} className="text-success" />}
      {state.kind === 'error' && <XCircle size={12} className="text-danger" />}
      {state.kind === 'idle' && <span className="w-3 h-3 rounded-full bg-elevated" />}
      {!compact && (
        <span className={
          state.kind === 'ok' ? 'text-success'
          : state.kind === 'error' ? 'text-danger'
          : 'text-fg-faint'
        }>
          {state.kind === 'ok' ? 'CLI detected'
            : state.kind === 'error' ? 'CLI not found'
            : state.kind === 'checking' ? 'Checking…'
            : 'Unknown'}
        </span>
      )}
    </span>
  )

  if (compact) return chip

  return (
    <div className="flex items-center gap-2">
      {chip}
      <button
        type="button"
        onClick={() => setTrigger(t => t + 1)}
        title="Re-check"
        className="p-1 rounded text-fg-faint hover:text-fg hover:bg-elevated"
      >
        <RefreshCw size={11} />
      </button>
    </div>
  )
}
