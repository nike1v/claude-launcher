import { useEffect, useState } from 'react'
import { useProjectsStore } from '../../store/projects'
import { useSessionsStore } from '../../store/sessions'
import { startSession, loadHistory } from '../../ipc/bridge'
import type { HistoryEntry, IpcChannels } from '../../../../shared/types'

export function HistoryList(): JSX.Element {
  const { activeProjectId } = useProjectsStore()
  const { addSession } = useSessionsStore()
  const [entries, setEntries] = useState<HistoryEntry[]>([])

  useEffect(() => {
    if (!activeProjectId) { setEntries([]); return }
    loadHistory(activeProjectId)

    const unsub = window.electronAPI.on(
      'projects:history',
      ({ projectId, entries: loaded }: IpcChannels['projects:history']) => {
        if (projectId === activeProjectId) setEntries(loaded)
      }
    )
    return unsub
  }, [activeProjectId])

  if (!entries.length) return <></>

  const resumeSession = async (entry: HistoryEntry) => {
    if (!activeProjectId) return
    const sessionId = await startSession(activeProjectId, entry.sessionId)
    addSession({ id: sessionId, projectId: activeProjectId, status: 'starting', hasUnread: false })
  }

  return (
    <div className="mt-4 px-3">
      <p className="text-xs font-medium text-white/30 uppercase tracking-wider mb-1">History</p>
      {entries.map(entry => (
        <button
          key={entry.sessionId}
          onClick={() => resumeSession(entry)}
          className="w-full text-left py-1 text-xs text-white/50 hover:text-white/80 truncate"
        >
          {entry.summary ?? entry.sessionId.slice(0, 12)}
        </button>
      ))}
    </div>
  )
}
