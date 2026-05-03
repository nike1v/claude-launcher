// Synthesises the CLI's interactive `/clear` for stream-json mode: stops
// the current provider process, drops its messages, and spawns a fresh
// session in the same tab slot. The Claude Agent SDK explicitly drops
// /clear ("Each query() call already starts a fresh conversation"), so
// the launcher emulates it locally.
//
// Same shape as ProjectItem's reset-conversation flow, minus the confirm
// dialog: typing /clear into the input is intentful enough on its own,
// and the transcript on disk is preserved either way.
import { startSession, stopSession } from '../ipc/bridge'
import { useSessionsStore } from '../store/sessions'
import { useProjectsStore } from '../store/projects'
import { useMessagesStore } from '../store/messages'

export async function restartConversation(sessionId: string): Promise<void> {
  const session = useSessionsStore.getState().sessions[sessionId]
  if (!session) return
  const projectId = session.projectId

  // Tear down the running CLI before re-spawning so its stdin pipe is
  // closed and the wrapper exits cleanly. session-manager's stop path
  // is idempotent, so a double-call from a fast-typing user is fine.
  stopSession(sessionId)

  // Drop the project's pinned resume ref before the new session starts.
  // Without this, listeners.ts's session.started handler is a no-op (the
  // ref is write-once) and the project would still point at the old
  // conversation when its tab was next reopened.
  const projects = useProjectsStore.getState().projects
  const project = projects.find(p => p.id === projectId)
  if (project) {
    useProjectsStore.getState().updateProject({
      ...project,
      lastSessionRef: undefined,
      // Cached against the now-forgotten conversation — let the next
      // session's first init repopulate them.
      lastModel: undefined,
      lastContextWindow: undefined
    })
  }

  let nextSessionId: string
  try {
    nextSessionId = await startSession(projectId)
  } catch (err) {
    console.error('[restartConversation] startSession failed for', projectId, err)
    return
  }

  // Swap the id in place so the tab keeps its slot — addSession would
  // append, which feels wrong for a /clear (the user expects "this same
  // tab, but emptied"). InputBar / MessageList key on sessionId so they
  // remount cleanly with the new id.
  useSessionsStore.getState().replaceSession(sessionId, {
    id: nextSessionId,
    projectId,
    sessionRef: undefined,
    status: 'starting',
    hasUnread: false,
    lastModel: undefined,
    lastContextWindow: undefined,
    lastUsedTokens: undefined
  })
  useMessagesStore.getState().clearSession(sessionId)
}
