import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { installUpdate } from '../ipc/bridge'
import type { UpdaterStatus } from '../../../../shared/types'

export function UpdateBanner(): JSX.Element | null {
  const [status, setStatus] = useState<UpdaterStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    return window.electronAPI.on('updater:status', setStatus)
  }, [])

  if (!status || status.state !== 'ready' || dismissed) return null

  return (
    <div className="flex items-center justify-between px-4 py-1.5 bg-blue-600/90 text-white text-sm">
      <span>
        Version {status.version} is ready to install
      </span>
      <div className="flex items-center gap-3">
        <button
          onClick={installUpdate}
          className="font-medium underline hover:no-underline"
        >
          Restart & Update
        </button>
        <button
          onClick={() => setDismissed(true)}
          aria-label="dismiss"
          className="hover:opacity-70"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
