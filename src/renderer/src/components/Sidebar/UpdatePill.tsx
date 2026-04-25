import { useState, useEffect } from 'react'
import { installUpdate } from '../../ipc/bridge'
import type { UpdaterStatus } from '../../../../shared/types'

export function UpdatePill(): JSX.Element | null {
  const [status, setStatus] = useState<UpdaterStatus | null>(null)

  useEffect(() => {
    return window.electronAPI.on('updater:status', setStatus)
  }, [])

  if (!status) return null
  if (status.state !== 'downloading' && status.state !== 'available' && status.state !== 'ready') {
    return null
  }

  const percent = typeof status.percent === 'number' ? Math.round(status.percent) : null

  return (
    <div className="px-2 pb-2 pt-1">
      <div className="rounded-2xl bg-blue-600/90 text-white text-xs px-3 py-2 flex flex-col gap-1.5">
        {status.state === 'downloading' && (
          <>
            <div className="flex items-center justify-between">
              <span className="font-medium">Downloading update</span>
              {percent !== null && <span className="tabular-nums opacity-90">{percent}%</span>}
            </div>
            {status.version && <span className="opacity-80">v{status.version}</span>}
            <div className="h-1 rounded-full bg-white/20 overflow-hidden">
              <div
                className="h-full bg-white/90 transition-all"
                style={{ width: percent !== null ? `${percent}%` : '0%' }}
              />
            </div>
          </>
        )}

        {status.state === 'available' && (
          <>
            <span className="font-medium">Update available</span>
            {status.version && <span className="opacity-80">v{status.version} — preparing download…</span>}
          </>
        )}

        {status.state === 'ready' && (
          <>
            <span className="font-medium">Update ready</span>
            {status.version && <span className="opacity-80">v{status.version}</span>}
            <button
              onClick={installUpdate}
              className="mt-0.5 self-start font-medium underline hover:no-underline"
            >
              Restart & Update
            </button>
          </>
        )}
      </div>
    </div>
  )
}
