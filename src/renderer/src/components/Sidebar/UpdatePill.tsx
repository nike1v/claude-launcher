import { useState, useEffect, type ReactNode } from 'react'
import { checkForUpdates, installUpdate } from '../../ipc/bridge'
import type { UpdaterStatus } from '../../../../shared/types'

// How long to keep the "Up to date" message on screen before auto-hiding,
// after a check finishes with no update available.
const UP_TO_DATE_LINGER_MS = 4000

export function UpdatePill() {
  const [status, setStatus] = useState<UpdaterStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    return window.electronAPI.on('updater:status', (s) => {
      setStatus(s)
      setDismissed(false)
    })
  }, [])

  // Auto-hide after a brief linger when a check resolves to up-to-date —
  // the pill is meant to be transient outside of an active update flow.
  useEffect(() => {
    if (status?.state !== 'up-to-date') return
    const t = setTimeout(() => setDismissed(true), UP_TO_DATE_LINGER_MS)
    return () => clearTimeout(t)
  }, [status])

  if (!status || dismissed) return null

  const view = describe(status)

  return (
    <div className="px-2 pb-2 pt-1">
      <div
        className={`h-[68px] rounded-2xl px-3 py-2 flex flex-col justify-between text-xs ${view.tone}`}
      >
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="font-medium truncate">{view.title}</span>
          {view.version && (
            <span className="opacity-80 tabular-nums truncate">v{view.version}</span>
          )}
        </div>
        <div className="text-xs">{view.action}</div>
      </div>
    </div>
  )
}

interface View {
  title: string
  version?: string
  tone: string
  action: ReactNode
}

function describe(status: UpdaterStatus): View {
  const tonePrimary = 'bg-blue-600/90 text-white'
  const toneNeutral = 'bg-white/[0.04] text-white/70 border border-white/10'
  const toneError = 'bg-red-600/80 text-white'

  switch (status.state) {
    case 'checking':
      return {
        title: 'Checking for updates',
        version: status.currentVersion,
        tone: toneNeutral,
        action: <ProgressBar percent={null} indeterminate />
      }

    case 'available':
      return {
        title: 'Update available',
        version: status.version,
        tone: tonePrimary,
        action: <ProgressBar percent={null} indeterminate label="Preparing download" />
      }

    case 'downloading': {
      const pct = typeof status.percent === 'number' ? Math.round(status.percent) : null
      return {
        title: 'Downloading update',
        version: status.version,
        tone: tonePrimary,
        action: <ProgressBar percent={pct} />
      }
    }

    case 'ready':
      return {
        title: 'Update ready',
        version: status.version,
        tone: tonePrimary,
        action: <ActionButton onClick={installUpdate} label="Restart & Update →" emphasized />
      }

    case 'error':
      return {
        title: 'Update failed',
        version: status.currentVersion,
        tone: toneError,
        action: <ActionButton onClick={checkForUpdates} label="Retry" />
      }

    case 'up-to-date':
    default:
      return {
        title: 'Up to date',
        version: status.currentVersion,
        tone: toneNeutral,
        action: <ActionButton onClick={checkForUpdates} label="Check for updates" />
      }
  }
}

function ActionButton({
  onClick,
  label,
  emphasized
}: {
  onClick: () => void
  label: string
  emphasized?: boolean
}) {
  // No horizontal padding so the action text starts at the same x as the
  // title text in the row above.
  return (
    <button
      onClick={onClick}
      className={`text-left text-xs transition-colors ${
        emphasized
          ? 'font-semibold text-white hover:text-white/80'
          : 'font-medium text-white/70 hover:text-white'
      }`}
    >
      {label}
    </button>
  )
}

function ProgressBar({
  percent,
  indeterminate,
  label
}: {
  percent: number | null
  indeterminate?: boolean
  label?: string
}) {
  const showHeader = !!label || percent !== null
  return (
    <div className="flex flex-col gap-1">
      {showHeader && (
        <div className="flex items-center justify-between text-xs">
          <span className="opacity-80 truncate">{label ?? ''}</span>
          {percent !== null && <span className="tabular-nums opacity-90">{percent}%</span>}
        </div>
      )}
      <div className="h-1 rounded-full bg-white/20 overflow-hidden relative">
        <div
          className={`h-full bg-white/90 ${indeterminate ? 'indeterminate-bar' : 'transition-all'}`}
          style={percent !== null ? { width: `${percent}%` } : undefined}
        />
      </div>
    </div>
  )
}
