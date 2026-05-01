import { useSessionsStore } from '../store/sessions'
import { useProjectsStore } from '../store/projects'
import { useEnvironmentsStore } from '../store/environments'
import { resolveProviderKind, type ProviderKind } from '../../../shared/events'

// Resolves the provider kind for a session by walking session →
// project → environment, applying the same precedence order
// (project override > env default > registry default) used in main.
// Returns the registry default if any link in the chain is missing —
// keeps callers free of null-checks for normal-case rendering.
//
// Used by AssistantMessage / InputBar / MessageList to surface the
// active provider's name in copy ("codex is thinking…") instead of
// hardcoding "claude".
export function useSessionProvider(sessionId: string): ProviderKind {
  const projectId = useSessionsStore(s => s.sessions[sessionId]?.projectId)
  const project = useProjectsStore(s =>
    projectId ? s.projects.find(p => p.id === projectId) : undefined
  )
  const env = useEnvironmentsStore(s =>
    project ? s.environments.find(e => e.id === project.environmentId) : undefined
  )
  return resolveProviderKind({
    projectKind: project?.providerKind,
    envKind: env?.providerKind
  })
}
