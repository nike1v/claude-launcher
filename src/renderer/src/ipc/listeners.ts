import { useEffect } from 'react'
import { useSessionsStore } from '../store/sessions'
import { useMessagesStore } from '../store/messages'
import { useProjectsStore } from '../store/projects'
import type { IpcChannels } from '../../../shared/types'

export function useIpcListeners(): void {
  const { updateSession } = useSessionsStore()
  const { appendEvent } = useMessagesStore()

  useEffect(() => {
    const unsubEvent = window.electronAPI.on(
      'session:event',
      ({ sessionId, event }: IpcChannels['session:event']) => {
        appendEvent(sessionId, event)
        // The init event carries the Claude CLI session id — record it so
        // we can resume this tab (--resume) and load its JSONL transcript
        // after an app restart.
        if (event.type === 'system' && event.subtype === 'init') {
          const current = useSessionsStore.getState().sessions[sessionId]
          if (current && current.claudeSessionId !== event.session_id) {
            updateSession(sessionId, { claudeSessionId: event.session_id })
          }
        }
        // Mark unread if not the active tab
        if (sessionId !== useSessionsStore.getState().activeSessionId) {
          updateSession(sessionId, { hasUnread: true })
        }
      }
    )

    const unsubStatus = window.electronAPI.on(
      'session:status',
      ({ sessionId, status, errorMessage }: IpcChannels['session:status']) => {
        updateSession(sessionId, { status, errorMessage })
      }
    )

    const unsubProjects = window.electronAPI.on(
      'projects:loaded',
      ({ projects }: IpcChannels['projects:loaded']) => {
        useProjectsStore.getState().setProjects(projects)
      }
    )

    return () => {
      unsubEvent()
      unsubStatus()
      unsubProjects()
    }
  }, [])
}
