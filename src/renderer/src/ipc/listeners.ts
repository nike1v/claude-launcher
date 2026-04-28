import { useEffect } from 'react'
import { useSessionsStore } from '../store/sessions'
import { useMessagesStore } from '../store/messages'
import { useProjectsStore } from '../store/projects'
import { useEnvironmentsStore } from '../store/environments'
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
        // after an app restart. claude --resume forks to a fresh session id,
        // so once we have an id (set by restoreTabs from the resumed
        // dialogue), keep it pinned to the source transcript.
        if (event.type === 'system' && event.subtype === 'init') {
          const current = useSessionsStore.getState().sessions[sessionId]
          if (current) {
            const update: Partial<typeof current> = {}
            if (!current.claudeSessionId) update.claudeSessionId = event.session_id
            if (event.model && current.lastModel !== event.model) update.lastModel = event.model
            if (Object.keys(update).length) updateSession(sessionId, update)
            // Pin metadata on the project record. claudeSessionId is
            // write-once (resume target). lastModel tracks latest so the
            // StatusBar can show a real model name immediately on a sidebar
            // re-open instead of a blank flash through the SSH cold-start.
            const projects = useProjectsStore.getState().projects
            const project = projects.find(p => p.id === current.projectId)
            if (project) {
              const projectUpdate: Partial<typeof project> = {}
              if (!project.lastClaudeSessionId) projectUpdate.lastClaudeSessionId = event.session_id
              if (event.model && project.lastModel !== event.model) projectUpdate.lastModel = event.model
              if (Object.keys(projectUpdate).length) {
                useProjectsStore.getState().updateProject({ ...project, ...projectUpdate })
              }
            }
          }
        }
        // Snapshot the context window the moment claude reports one — so a
        // cold restore can pull it from tabs.json and show a real total
        // before the new turn finishes.
        if (event.type === 'result') {
          const mu = (event as { modelUsage?: Record<string, { contextWindow?: number }> }).modelUsage
          if (mu) {
            for (const v of Object.values(mu)) {
              if (v?.contextWindow) {
                const current = useSessionsStore.getState().sessions[sessionId]
                if (current && current.lastContextWindow !== v.contextWindow) {
                  updateSession(sessionId, { lastContextWindow: v.contextWindow })
                  // Mirror onto the project so the next sidebar re-open
                  // shows the right context-window total before its first
                  // result lands.
                  const project = useProjectsStore.getState().projects
                    .find(p => p.id === current.projectId)
                  if (project && project.lastContextWindow !== v.contextWindow) {
                    useProjectsStore.getState().updateProject({
                      ...project,
                      lastContextWindow: v.contextWindow
                    })
                  }
                }
                break
              }
            }
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

    const unsubEnvironments = window.electronAPI.on(
      'environments:loaded',
      ({ environments }: IpcChannels['environments:loaded']) => {
        useEnvironmentsStore.getState().setEnvironments(environments)
      }
    )

    return () => {
      unsubEvent()
      unsubStatus()
      unsubProjects()
      unsubEnvironments()
    }
  }, [])
}
