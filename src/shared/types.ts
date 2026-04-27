// ── Project / Host ──────────────────────────────────────────────────────────

export type HostType =
  | { kind: 'local' }
  | { kind: 'wsl'; distro: string }
  | { kind: 'ssh'; user: string; host: string; port?: number; keyFile?: string }

export interface Project {
  id: string
  name: string
  host: HostType
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
}

export interface PersistedTab {
  projectId: string
  claudeSessionId: string
}

export interface PersistedTabs {
  tabs: PersistedTab[]
  activeIndex: number | null
}

export interface HistoryEntry {
  sessionId: string
  createdAt: string
  summary?: string
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
  'session:permission': { sessionId: string; decision: 'allow' | 'deny'; toolUseId: string }
  'dialog:saveFile': { defaultName: string; mediaType: string; data: string }
  'projects:save': Project[]
  'projects:history:load': { projectId: string }
  'session:history:load': { projectId: string; sessionId: string }
  'projects:load': Record<string, never>
  'tabs:load': Record<string, never>
  'tabs:save': PersistedTabs
  'updater:check': Record<string, never>
  'updater:install': Record<string, never>

  // Main → Renderer (events)
  'session:event': { sessionId: string; event: StreamJsonEvent }
  'session:status': { sessionId: string; status: Session['status']; errorMessage?: string }
  'projects:history': { projectId: string; entries: HistoryEntry[] }
  'projects:loaded': { projects: Project[] }
  'updater:status': UpdaterStatus
}

export type IpcInvokeChannel = Extract<
  keyof IpcChannels,
  | 'session:start' | 'session:send' | 'session:stop' | 'session:permission'
  | 'projects:save' | 'projects:history:load' | 'session:history:load' | 'projects:load'
  | 'tabs:load' | 'tabs:save'
  | 'updater:check' | 'updater:install'
  | 'dialog:saveFile'
>

export type IpcEventChannel = Extract<
  keyof IpcChannels,
  'session:event' | 'session:status' | 'projects:history' | 'projects:loaded' | 'updater:status'
>
