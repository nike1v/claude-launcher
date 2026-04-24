export async function startSession(
  projectId: string,
  resumeSessionId?: string
): Promise<string> {
  return window.electronAPI.invoke('session:start', { projectId, resumeSessionId }) as Promise<string>
}

export function sendMessage(sessionId: string, text: string): void {
  window.electronAPI.invoke('session:send', { sessionId, text })
}

export function stopSession(sessionId: string): void {
  window.electronAPI.invoke('session:stop', { sessionId })
}

export function respondPermission(
  sessionId: string,
  decision: 'allow' | 'deny',
  toolUseId: string
): void {
  window.electronAPI.invoke('session:permission', { sessionId, decision, toolUseId })
}

export function loadHistory(projectId: string): void {
  window.electronAPI.invoke('projects:history:load', { projectId })
}

export async function loadSessionHistory(projectId: string, sessionId: string): Promise<import('../../../shared/types').StreamJsonEvent[]> {
  return window.electronAPI.invoke('session:history:load', { projectId, sessionId }) as Promise<import('../../../shared/types').StreamJsonEvent[]>
}

export function installUpdate(): void {
  window.electronAPI.invoke('updater:install', {})
}
