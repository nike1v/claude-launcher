// ── Environment / Project ───────────────────────────────────────────────────

// HostType is the transport-level shape used by spawn commands. It used to
// live on every Project; we now factor it out into Environments so multiple
// projects can share one connection (one local CLI, one WSL distro, one SSH
// host). HostType remains the runtime contract for transports.
export type HostType =
  | { kind: 'local' }
  | { kind: 'wsl'; distro: string }
  // `host` may be a real hostname or a Host alias from ~/.ssh/config. When
  // it's an alias, leave user/port/keyFile empty and OpenSSH will pick them
  // up from the config file; we just invoke `ssh <alias>`.
  | { kind: 'ssh'; user?: string; host: string; port?: number; keyFile?: string }

export interface Environment {
  id: string
  name: string
  config: HostType
  // Optional default model id for this environment. Projects under it inherit
  // unless they override via Project.model. Stored alongside the connection
  // because users typically pick a tier per machine, not per project.
  defaultModel?: string
}

export interface Project {
  id: string
  name: string
  environmentId: string
  path: string
  model?: string
}

export interface Session {
  id: string
  projectId: string
  // Claude CLI session id (stable across --resume); used for restoring
  // tabs across app restarts and loading history from the JSONL transcript.
  // Undefined until the first init event arrives for a fresh session.
  claudeSessionId?: string
  status: 'starting' | 'ready' | 'busy' | 'error' | 'closed'
  pid?: number
  hasUnread: boolean
  errorMessage?: string
  // Cached metadata used by the status bar before the current run's init /
  // result events have arrived. Updated whenever new info comes in and
  // persisted via tabs.json so a cold-restored tab is informative right
  // away instead of going through a "blank model + 200K total" flash.
  lastModel?: string
  lastContextWindow?: number
}

export interface PersistedTab {
  projectId: string
  claudeSessionId: string
  lastModel?: string
  lastContextWindow?: number
}

export interface PersistedTabs {
  tabs: PersistedTab[]
  activeIndex: number | null
}

// ── Stream-JSON events (Claude CLI --output-format stream-json) ──────────────

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'thinking'; thinking: string; signature?: string }

export type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string | ContentBlock[]
  is_error?: boolean
}

// Anthropic content blocks the user can attach to a prompt.
export type ImageSource = { type: 'base64'; media_type: string; data: string }
export type ImageBlock = { type: 'image'; source: ImageSource }
export type DocumentBlock = { type: 'document'; source: ImageSource }

export type UserContentBlock = ContentBlock | ToolResultBlock | ImageBlock | DocumentBlock

// Attachment payload from renderer → main when sending a message.
export type SendAttachment =
  | { kind: 'image'; mediaType: string; data: string; name?: string }
  | { kind: 'document'; mediaType: string; data: string; name: string }
  | { kind: 'text'; name: string; text: string }

export interface InitEvent {
  type: 'system'
  subtype: 'init'
  session_id: string
  model: string
  cwd: string
  tools: unknown[]
  mcp_servers: unknown[]
}

export interface AssistantEvent {
  type: 'assistant'
  message: {
    id: string
    type: 'message'
    role: 'assistant'
    content: ContentBlock[]
    model: string
    stop_reason: string | null
    usage: TokenUsage
  }
}

export interface UserEvent {
  type: 'user'
  message: {
    role: 'user'
    content: string | UserContentBlock[]
  }
}

export interface ResultEvent {
  type: 'result'
  subtype: 'success' | 'error_max_turns' | 'error_during_execution'
  session_id: string
  cost_usd?: number
  duration_ms?: number
  is_error: boolean
  num_turns: number
  total_cost_usd?: number
  // claude reports context-window size per model in modelUsage; we read the
  // first entry to drive the context-fill indicator in the status bar.
  modelUsage?: Record<string, { contextWindow?: number; maxOutputTokens?: number }>
}

export type StreamJsonEvent = InitEvent | AssistantEvent | UserEvent | ResultEvent

// ── Subscription usage (scraped from claude's /usage panel) ─────────────────

export interface UsageBar {
  // Stable id the renderer keys on for icons / colors.
  key: 'session' | 'weekly_all' | 'weekly_sonnet' | 'weekly_opus' | string
  label: string
  percent: number
  resetsAt?: string
}

export interface UsageReading {
  bars: UsageBar[]
  totalCostUsd?: string
  totalDurationApi?: string
}

export type UsageProbeResult =
  | { ok: true; reading: UsageReading }
  | { ok: false; reason: string }

// ── Updater ──────────────────────────────────────────────────────────────────

export interface UpdaterStatus {
  state: 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error'
  version?: string // version under consideration (new release for available/downloading/ready)
  currentVersion?: string // what's actually installed right now
  percent?: number
  message?: string
}

// ── IPC channel contracts ────────────────────────────────────────────────────

export interface IpcChannels {
  // Renderer → Main (invoke)
  'session:start': { projectId: string; resumeSessionId?: string }
  'session:send': { sessionId: string; text: string; attachments?: SendAttachment[] }
  'session:stop': { sessionId: string }
  'session:interrupt': { sessionId: string }
  'session:permission': { sessionId: string; decision: 'allow' | 'deny'; toolUseId: string }
  'dialog:saveFile': { defaultName: string; mediaType: string; data: string }
  'projects:save': Project[]
  'session:history:load': { projectId: string; sessionId: string }
  'projects:load': Record<string, never>
  'environments:save': Environment[]
  'environments:load': Record<string, never>
  // Run `claude --version` over the env's transport. Either { ok: true,
  // version } or { ok: false, reason }. Used to populate health badges in
  // the Settings modal and to validate before "Add Environment" saves.
  'environments:probe': { config: HostType }
  // Subscription usage probe — PTY-spawn claude on the env, type /usage,
  // screen-scrape the panel into structured bars. There's no machine-readable
  // /usage in claude itself, so this is the only way to surface those numbers
  // inside the launcher.
  'environments:usage': { config: HostType }
  // Directory listing over an environment's transport. Returns child dir
  // names (no files) so the path combobox can suggest paths as the user
  // types. `path` is the directory to list — empty = the host's home.
  'fs:listDir': { config: HostType; path: string }
  'tabs:load': Record<string, never>
  'tabs:save': PersistedTabs
  'updater:check': Record<string, never>
  'updater:install': Record<string, never>

  // Main → Renderer (events)
  'session:event': { sessionId: string; event: StreamJsonEvent }
  'session:status': { sessionId: string; status: Session['status']; errorMessage?: string }
  'projects:loaded': { projects: Project[] }
  'environments:loaded': { environments: Environment[] }
  'updater:status': UpdaterStatus
}

export type IpcInvokeChannel = Extract<
  keyof IpcChannels,
  | 'session:start' | 'session:send' | 'session:stop' | 'session:interrupt' | 'session:permission'
  | 'projects:save' | 'session:history:load' | 'projects:load'
  | 'environments:save' | 'environments:load' | 'environments:probe' | 'environments:usage'
  | 'fs:listDir'
  | 'tabs:load' | 'tabs:save'
  | 'updater:check' | 'updater:install'
  | 'dialog:saveFile'
>

export type IpcEventChannel = Extract<
  keyof IpcChannels,
  'session:event' | 'session:status' | 'projects:loaded' | 'environments:loaded' | 'updater:status'
>

// The shape contextBridge exposes on `window.electronAPI`. Lifted to shared/
// so the renderer can typecheck `window.electronAPI.invoke(...)` without
// reaching into the preload's compile unit (which lives under the node
// tsconfig project and isn't visible to the renderer's web tsconfig).
export interface ElectronApi {
  platform: NodeJS.Platform
  invoke<K extends keyof IpcChannels>(
    channel: K,
    payload: IpcChannels[K]
  ): Promise<unknown>
  on<K extends IpcEventChannel>(
    channel: K,
    handler: (payload: IpcChannels[K]) => void
  ): () => void
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Window {
    electronAPI: ElectronApi
  }
}
