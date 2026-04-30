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

// Routes through main because (a) navigator.clipboard.writeText is blocked
// by our deny-all setPermissionRequestHandler (v0.4.4) on the
// `clipboard-sanitized-write` permission, and (b) the `clipboard` electron
// module is NOT in the sandboxed preload's allow-list. Main has the full
// electron API and calls clipboard.writeText() from there.
export function copyText(text: string): void {
  window.electronAPI.invoke('clipboard:write', text)
}

export function interruptSession(sessionId: string): void {
  window.electronAPI.invoke('session:interrupt', { sessionId })
}

export function respondPermission(
  sessionId: string,
  decision: 'allow' | 'deny',
  toolUseId: string
): void {
  window.electronAPI.invoke('session:permission', { sessionId, decision, toolUseId })
}

export async function loadSessionHistory(
  projectId: string,
  sessionId: string
): Promise<{ events: import('../../../shared/events').NormalizedEvent[]; diagnostic?: string }> {
  return window.electronAPI.invoke('session:history:load', { projectId, sessionId }) as Promise<{
    events: import('../../../shared/events').NormalizedEvent[]
    diagnostic?: string
  }>
}

// Lists the claude session ids found in the project's transcripts dir on
// its env. Used by the project-edit autocomplete so the user can pick a
// real conversation instead of typing a UUID. Returns [] for fresh
// projects or unreachable envs — the UI treats empty as "no suggestions".
export async function listSessionIds(projectId: string): Promise<string[]> {
  return window.electronAPI.invoke('session:history:list', { projectId }) as Promise<string[]>
}

export function installUpdate(): void {
  window.electronAPI.invoke('updater:install', {})
}

export function checkForUpdates(): void {
  window.electronAPI.invoke('updater:check', {})
}

export async function probeEnvironment(
  config: import('../../../shared/types').HostType
): Promise<{ ok: true; version: string } | { ok: false; reason: string }> {
  return window.electronAPI.invoke('environments:probe', { config }) as Promise<
    { ok: true; version: string } | { ok: false; reason: string }
  >
}

export async function probeEnvironmentUsage(
  config: import('../../../shared/types').HostType
): Promise<import('../../../shared/types').UsageProbeResult> {
  return window.electronAPI.invoke('environments:usage', { config }) as Promise<
    import('../../../shared/types').UsageProbeResult
  >
}

export async function listDir(
  config: import('../../../shared/types').HostType,
  path: string
): Promise<{ cwd: string; entries: string[]; error?: string }> {
  return window.electronAPI.invoke('fs:listDir', { config, path }) as Promise<{
    cwd: string
    entries: string[]
    error?: string
  }>
}

export async function loadTabs(): Promise<import('../../../shared/types').PersistedTabs> {
  return window.electronAPI.invoke('tabs:load', {}) as Promise<import('../../../shared/types').PersistedTabs>
}

export function saveTabs(state: import('../../../shared/types').PersistedTabs): void {
  window.electronAPI.invoke('tabs:save', state).catch((err: unknown) => {
    console.error('[tabs:save] persistence write failed', err)
  })
}
