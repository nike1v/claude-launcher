import { useState } from 'react'
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
// probe state inline + a chevron that expands to a row of all four
// providers. Each provider gets its own probe (parallelised on
// mount), so the user can see at a glance which CLIs are reachable on
// this host.
//
// Probes run only when the panel is expanded — keeping the collapsed
// state cheap (1 probe per env) while letting the user pull the full
// picture on demand. SSH cold-start can be slow; running four probes
// in parallel shares the wrapper overhead.
export function ProvidersStatus({ config, defaultProviderKind = 'claude' }: Props) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        title={expanded ? 'Hide other providers' : 'Show all providers'}
        className="flex items-center gap-1 text-xs hover:text-fg transition-colors"
      >
        <EnvironmentStatus config={config} providerKind={defaultProviderKind} compact />
        <ChevronDown
          size={11}
          className={`text-fg-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="flex flex-col gap-1 px-2 py-1.5 rounded border border-divider bg-elevated min-w-[160px]">
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
