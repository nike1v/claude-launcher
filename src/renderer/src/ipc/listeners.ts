import { useEffect } from 'react'
import { useSessionsStore } from '../store/sessions'
import { useMessagesStore } from '../store/messages'
import { useProjectsStore } from '../store/projects'
import { useEnvironmentsStore } from '../store/environments'
import type { IpcChannels } from '../../../shared/types'
import type { NormalizedEvent } from '../../../shared/events'

export function useIpcListeners(): void {
  const { updateSession } = useSessionsStore()
  const { appendEvents } = useMessagesStore()

  useEffect(() => {
    const unsubEvent = window.electronAPI.on(
      'session:event',
      ({ sessionId, events }: IpcChannels['session:event']) => {
        // Single store mutation for the whole batch — the renderer
        // re-renders once per chunk instead of once per emitted event.
        appendEvents(sessionId, events)
        for (const event of events) applyMetadata(sessionId, event)
        if (sessionId !== useSessionsStore.getState().activeSessionId) {
          updateSession(sessionId, { hasUnread: true })
        }
      }
    )

    const unsubStatus = window.electronAPI.on(
      'session:status',
      ({ sessionId, status, errorMessage }: IpcChannels['session:status']) => {
        updateSession(sessionId, { status, errorMessage })
        // Stop-request marker is cleared when the turn fully ends
        // (ready / error / closed). 'busy' and 'interrupting' both
        // count as in-flight — keeping the marker through 'interrupting'
        // is what drives the "stop sent…" → "no acknowledgement after
        // Ns…" copy under the spinner.
        if (status !== 'busy' && status !== 'compacting' && status !== 'interrupting') {
          useMessagesStore.getState().clearStopRequest(sessionId)
        }
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
    // Replace on every init — the CLI rediscovers commands per spawn,
    // so a project that added a new skill should see it without an app
    // restart. JSON-equality skips the store update on unchanged lists
    // so subscribers don't re-render needlessly.
    if (event.slashCommands && JSON.stringify(current.slashCommands) !== JSON.stringify(event.slashCommands)) {
      update.slashCommands = event.slashCommands
    }
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
      // Cache slash_commands on the project so the next tab opened for
      // this project hydrates its autocomplete popup immediately,
      // instead of waiting for claude's first system/init (which only
      // fires after the user's first message).
      if (event.slashCommands && JSON.stringify(project.slashCommands) !== JSON.stringify(event.slashCommands)) {
        projectUpdate.slashCommands = event.slashCommands
      }
      if (Object.keys(projectUpdate).length) {
        useProjectsStore.getState().updateProject({ ...project, ...projectUpdate })
      }
    }
    return
  }

  if (event.kind === 'tokenUsage.updated') {
    const current = useSessionsStore.getState().sessions[sessionId]
    if (!current) return
    const u = event.usage
    // Both halves of the StatusBar meter need a sticky cache: contextWindow
    // for the denominator and (input + cached) tokens for the numerator.
    // parseTranscript skips tokenUsage.updated events on cold replay, so
    // without these caches the meter would show 0 / 200K until the next
    // live turn. We accept transient subagent values here too — the
    // bigger picture filtering (subagent bleed-through) is a separate bug.
    const nextUsed =
      u.inputTokens !== undefined || u.cachedInputTokens !== undefined
        ? (u.inputTokens ?? 0) + (u.cachedInputTokens ?? 0)
        : undefined
    const sessionUpdate: Partial<typeof current> = {}
    if (u.contextWindow !== undefined && current.lastContextWindow !== u.contextWindow) {
      sessionUpdate.lastContextWindow = u.contextWindow
    }
    if (nextUsed !== undefined && current.lastUsedTokens !== nextUsed) {
      sessionUpdate.lastUsedTokens = nextUsed
    }
    if (Object.keys(sessionUpdate).length) updateSession(sessionId, sessionUpdate)

    const project = useProjectsStore.getState().projects.find(p => p.id === current.projectId)
    if (project) {
      const projectUpdate: Partial<typeof project> = {}
      if (u.contextWindow !== undefined && project.lastContextWindow !== u.contextWindow) {
        projectUpdate.lastContextWindow = u.contextWindow
      }
      if (nextUsed !== undefined && project.lastUsedTokens !== nextUsed) {
        projectUpdate.lastUsedTokens = nextUsed
      }
      if (Object.keys(projectUpdate).length) {
        useProjectsStore.getState().updateProject({ ...project, ...projectUpdate })
      }
    }
  }
}
