import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { HostType } from '../../../../shared/types'
import type { ProviderKind } from '../../../../shared/events'
import { EnvironmentStatus } from './EnvironmentStatus'
import { PROVIDER_OPTIONS, providerLabel, providerBin } from '../../lib/provider-options'

interface Props {
  config: HostType
  // Env's default provider — gets the at-a-glance dot in the collapsed
  // state. Defaults to claude for envs persisted before per-env provider
  // selection landed.
  defaultProviderKind?: ProviderKind
}

// Compact entry-point for the env row: shows the default provider's
// probe state inline + a chevron that, when clicked, opens a floating
// popover above the row with status for all four providers (each
// probed in parallel). The popover is absolutely positioned so it
// doesn't push the row layout — same anchoring pattern used by
// dropdowns elsewhere in the app.
//
// Probes only run when the popover is open, keeping the collapsed
// state cheap (1 probe per env). SSH cold-start is the slow case;
// four parallel probes share the wrapper overhead so the wait is
// dominated by the slowest single probe, not the sum.
export function ProvidersStatus({ config, defaultProviderKind = 'claude' }: Props) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDocMouseDown)
    return () => window.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={open ? 'Hide other providers' : 'Show all providers'}
        className="flex items-center gap-1 text-xs hover:text-fg transition-colors"
      >
        <EnvironmentStatus config={config} providerKind={defaultProviderKind} compact />
        <ChevronDown
          size={11}
          className={`text-fg-faint transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 flex flex-col gap-1.5 px-3 py-2 rounded border border-divider bg-panel shadow-lg min-w-[200px]">
          {PROVIDER_OPTIONS.map(opt => (
            <div key={opt.value} className="flex items-center justify-between gap-3 text-[11px]">
              <span className="flex items-center gap-1.5">
                <span className="text-fg-muted">{providerLabel(opt.value)}</span>
                <span className="font-mono text-fg-faint">({providerBin(opt.value)})</span>
              </span>
              <EnvironmentStatus config={config} providerKind={opt.value} compact />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
