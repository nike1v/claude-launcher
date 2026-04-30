import { useEffect } from 'react'
import { useSessionsStore } from '../store/sessions'
import { useMessagesStore } from '../store/messages'
import { useProjectsStore } from '../store/projects'
import { useEnvironmentsStore } from '../store/environments'
import type { IpcChannels } from '../../../shared/types'
import type { NormalizedEvent } from '../../../shared/events'

export function useIpcListeners(): void {
  const { updateSession } = useSessionsStore()
  const { appendEvent } = useMessagesStore()

  useEffect(() => {
    const unsubEvent = window.electronAPI.on(
      'session:event',
      ({ sessionId, event }: IpcChannels['session:event']) => {
        appendEvent(sessionId, event)
        applyMetadata(sessionId, event)
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

// Pulls session-level metadata out of the normalized event stream:
// - session.started carries the provider session ref (for resume) and
//   the model name. We pin sessionRef on first arrival (claude --resume
//   forks a fresh id, so once we have one, keep it pointed at the
//   source transcript). lastModel updates whenever a new value arrives.
// - tokenUsage.updated with contextWindow updates the StatusBar's total
//   so a cold restore can pull it from tabs.json and show a real total
//   before the next turn finishes.
function applyMetadata(sessionId: string, event: NormalizedEvent): void {
  const { updateSession } = useSessionsStore.getState()

  if (event.kind === 'session.started') {
    const current = useSessionsStore.getState().sessions[sessionId]
    if (!current) return
    const update: Partial<typeof current> = {}
    if (!current.sessionRef) update.sessionRef = event.sessionRef
    if (event.model && current.lastModel !== event.model) update.lastModel = event.model
    if (Object.keys(update).length) updateSession(sessionId, update)

    // Mirror metadata on the project record so a fresh sidebar re-open
    // shows real values immediately instead of a blank flash through the
    // SSH cold-start.
    const projects = useProjectsStore.getState().projects
    const project = projects.find(p => p.id === current.projectId)
    if (project) {
      const projectUpdate: Partial<typeof project> = {}
      if (!project.lastSessionRef) projectUpdate.lastSessionRef = event.sessionRef
      if (event.model && project.lastModel !== event.model) projectUpdate.lastModel = event.model
      if (Object.keys(projectUpdate).length) {
        useProjectsStore.getState().updateProject({ ...project, ...projectUpdate })
      }
    }
    return
  }

  if (event.kind === 'tokenUsage.updated' && event.usage.contextWindow) {
    const current = useSessionsStore.getState().sessions[sessionId]
    if (!current) return
    if (current.lastContextWindow !== event.usage.contextWindow) {
      updateSession(sessionId, { lastContextWindow: event.usage.contextWindow })
      const project = useProjectsStore.getState().projects.find(p => p.id === current.projectId)
      if (project && project.lastContextWindow !== event.usage.contextWindow) {
        useProjectsStore.getState().updateProject({
          ...project,
          lastContextWindow: event.usage.contextWindow
        })
      }
    }
  }
}
