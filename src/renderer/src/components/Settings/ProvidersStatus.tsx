import { useState } from 'react'
import { Search, X } from 'lucide-react'
import type { HostType } from '../../../../shared/types'
import { EnvironmentStatus } from './EnvironmentStatus'
import { Modal } from '../Modal'
import { PROVIDER_OPTIONS, providerLabel, providerBin } from '../../lib/provider-options'
import { describeHost } from '../../../../shared/host-utils'

interface Props {
  config: HostType
  envName?: string
}

// "Check all providers" button on the env row. Idle until clicked —
// no eager probe, since each provider's --version walk takes a few
// seconds on SSH and the user mostly doesn't care about the row's
// status until they're investigating something. Click opens a modal
// that probes all four providers in parallel.
export function ProvidersStatus({ config, envName }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Check all providers on this env"
        className="flex items-center gap-1 px-2 py-1 rounded text-xs text-fg-muted hover:text-fg hover:bg-elevated border border-divider transition-colors"
      >
        <Search size={11} />
        <span>Check</span>
      </button>
      {open && (
        <ProvidersProbeModal
          config={config}
          envName={envName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function ProvidersProbeModal({
  config,
  envName,
  onClose
}: {
  config: HostType
  envName?: string
  onClose: () => void
}) {
  return (
    <Modal onClose={onClose} panelClassName="bg-panel border border-divider rounded-lg p-4 w-[380px] shadow-xl">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">Provider availability</h2>
          <p className="text-[11px] text-fg-faint truncate">
            {envName ? `${envName} · ${describeHost(config)}` : describeHost(config)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded text-fg-faint hover:text-fg hover:bg-elevated"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {PROVIDER_OPTIONS.map(opt => (
          <div
            key={opt.value}
            className="flex items-center justify-between gap-3 px-3 py-2 rounded border border-divider"
          >
            <span className="flex flex-col min-w-0">
              <span className="text-xs text-fg">{providerLabel(opt.value)}</span>
              <span className="font-mono text-[10px] text-fg-faint">{providerBin(opt.value)}</span>
            </span>
            <EnvironmentStatus config={config} providerKind={opt.value} compact />
          </div>
        ))}
      </div>
    </Modal>
  )
}
