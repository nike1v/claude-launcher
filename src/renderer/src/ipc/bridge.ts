export async function startSession(
  projectId: string,
  resumeSessionId?: string
): Promise<string> {
  return window.electronAPI.invoke('session:start', { projectId, resumeSessionId }) as Promise<string>
}

export function sendMessage(
  sessionId: string,
  text: string,
  attachments?: import('../../../shared/types').SendAttachment[]
): void {
  window.electronAPI.invoke('session:send', { sessionId, text, attachments })
}

export async function saveFileAs(
  defaultName: string,
  mediaType: string,
  data: string
): Promise<{ saved: boolean; path?: string }> {
  return window.electronAPI.invoke('dialog:saveFile', { defaultName, mediaType, data }) as Promise<{
    saved: boolean
    path?: string
  }>
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

export function checkForUpdates(): void {
  window.electronAPI.invoke('updater:check', {})
}

export async function loadTabs(): Promise<import('../../../shared/types').PersistedTabs> {
  return window.electronAPI.invoke('tabs:load', {}) as Promise<import('../../../shared/types').PersistedTabs>
}

export function saveTabs(state: import('../../../shared/types').PersistedTabs): void {
  window.electronAPI.invoke('tabs:save', state)
}
