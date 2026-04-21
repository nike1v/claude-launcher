// ── Project / Host ──────────────────────────────────────────────────────────

export type HostType =
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
  status: 'starting' | 'ready' | 'busy' | 'error' | 'closed'
  pid?: number
  hasUnread: boolean
  errorMessage?: string
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

export type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string | ContentBlock[]
  is_error?: boolean
}

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
    content: ToolResultBlock[]
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
}

export type StreamJsonEvent = InitEvent | AssistantEvent | UserEvent | ResultEvent

// ── IPC channel contracts ────────────────────────────────────────────────────

export interface IpcChannels {
  // Renderer → Main
  'session:start': { projectId: string; resumeSessionId?: string }
  'session:send': { sessionId: string; text: string }
  'session:stop': { sessionId: string }
  'session:permission': { sessionId: string; decision: 'allow' | 'deny'; toolUseId: string }
  'projects:save': Project[]
  'projects:history:load': { projectId: string }
  'projects:load': Record<string, never>  // renderer calls on startup to get persisted projects

  // Main → Renderer (events, not invoke/handle)
  'session:event': { sessionId: string; event: StreamJsonEvent }
  'session:status': { sessionId: string; status: Session['status']; errorMessage?: string }
  'projects:history': { projectId: string; entries: HistoryEntry[] }
  'projects:loaded': { projects: Project[] }  // response to projects:load
}

export type IpcInvokeChannel = Extract<
  keyof IpcChannels,
  'session:start' | 'session:send' | 'session:stop' | 'session:permission' |
  'projects:save' | 'projects:history:load' | 'projects:load'
>

export type IpcEventChannel = Extract<
  keyof IpcChannels,
  'session:event' | 'session:status' | 'projects:history' | 'projects:loaded'
>
