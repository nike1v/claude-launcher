// Provider-agnostic event taxonomy. Each IProvider's adapter (added in
// a later PR) translates its native wire format into this shape; the
// renderer + history reader render only this shape. Sized between
// claude's stream-json (4 variants) and t3code's runtime events (~45
// variants) — small enough to enumerate but rich enough to capture
// "items inside a turn" + "streaming content deltas" + "approval
// requests separate from items".

// ── Provider identity ────────────────────────────────────────────────────

export type ProviderKind = 'claude' | 'codex' | 'opencode' | 'cursor'

export const PROVIDER_KINDS: readonly ProviderKind[] = ['claude', 'codex', 'opencode', 'cursor']

// Persisted Project / Environment records before this field existed
// load with `providerKind: undefined`; this is the value to substitute.
export const DEFAULT_PROVIDER_KIND: ProviderKind = 'claude'

export function isProviderKind(v: unknown): v is ProviderKind {
  return typeof v === 'string' && (PROVIDER_KINDS as readonly string[]).includes(v)
}

// ── Approval / permission decisions ──────────────────────────────────────

// Four states match what claude actually supports today (the "always
// allow" affordance is `acceptForSession`) and what codex / cursor
// expose. The renderer's PermissionPrompt still drives only allow/deny
// today; the wire format is widened so providers don't have to revisit
// the IPC shape later.
export type ApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel'

// ── NormalizedEvent supporting types ─────────────────────────────────────

export type SessionState = 'starting' | 'ready' | 'running' | 'waiting' | 'stopped' | 'error'

// Sub-units of a turn. Claude's "tool_use" content block becomes
// `tool_use`; codex `command_execution` and `file_change` are first-class
// items; opencode + cursor map cleanly onto this set. `unknown` is the
// escape hatch for forward-compat with new item types.
export type ItemType =
  | 'user_message'
  | 'assistant_message'
  | 'reasoning'
  | 'plan'
  | 'tool_use'
  | 'file_change'
  | 'command_execution'
  | 'web_search'
  | 'unknown'

// Streaming text classes. Drives styling (assistant text vs. reasoning
// vs. command stdout — different bubble treatments).
export type ContentStreamKind =
  | 'assistant_text'
  | 'reasoning_text'
  | 'plan_text'
  | 'command_output'
  | 'unknown'

// Approval-flavoured request types. `tool_approval` is claude's
// permission-prompt-tool flow; `command_approval` is codex's sandboxed
// exec wanting permission; `file_change_approval` is the same for writes.
export type RequestType =
  | 'tool_approval'
  | 'command_approval'
  | 'file_change_approval'
  | 'unknown'

export type ErrorClass =
  | 'provider_error'
  | 'transport_error'
  | 'permission_error'
  | 'validation_error'
  | 'unknown'

export interface TokenUsage {
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  contextWindow?: number
}

// Structured user-input questions (e.g. an MCP tool asking the user to
// pick from a list before continuing). Distinct from approval prompts —
// approval is yes/no, this is "answer N questions". Codex / opencode
// surface this; claude does not today.
export interface UserInputQuestion {
  id: string
  prompt: string
  kind: 'text' | 'choice'
  choices?: readonly string[]
}

export type TurnStatus = 'completed' | 'failed' | 'interrupted'

export type ItemStatus = 'completed' | 'failed' | 'declined'

export type SessionExitKind = 'graceful' | 'error'

// ── NormalizedEvent ──────────────────────────────────────────────────────

export type NormalizedEvent =
  // Session lifecycle — the spawn ↔ ready ↔ exited boundary.
  | { kind: 'session.started'; sessionRef: string; model?: string }
  | { kind: 'session.stateChanged'; state: SessionState; reason?: string }
  | { kind: 'session.exited'; reason?: string; exitKind: SessionExitKind }

  // Turn lifecycle — one user message → one assistant reply, plus the
  // tool calls / approvals that happen inside.
  | { kind: 'turn.started'; turnId: string; model?: string }
  | { kind: 'turn.completed'; turnId: string; status: TurnStatus; usage?: TokenUsage }

  // Items inside a turn. `item.started` opens a slot; `content.delta`
  // streams text into it; `item.completed` closes it. Tool uses, file
  // changes, reasoning, plans all flow through the same start/delta/end
  // pattern.
  | { kind: 'item.started'; itemId: string; turnId: string; itemType: ItemType }
  | { kind: 'item.completed'; itemId: string; status: ItemStatus }

  | { kind: 'content.delta'; itemId: string; streamKind: ContentStreamKind; text: string }

  // Approval flow — distinct from items because some providers emit a
  // request *before* the item starts (codex pre-execution check).
  | { kind: 'request.opened'; requestId: string; itemId?: string; requestType: RequestType; payload: unknown }
  | { kind: 'request.resolved'; requestId: string; decision: ApprovalDecision }

  // Structured user input — multiple-choice prompts from MCP tools etc.
  | { kind: 'userInput.requested'; requestId: string; questions: readonly UserInputQuestion[] }
  | { kind: 'userInput.resolved'; requestId: string; answers: Readonly<Record<string, unknown>> }

  // Streaming token usage updates (some providers emit periodically, not
  // just at turn-end).
  | { kind: 'tokenUsage.updated'; usage: TokenUsage }

  // Errors / warnings — surfaced to the user as banners, not turn output.
  | { kind: 'warning'; message: string; detail?: unknown }
  | { kind: 'error'; message: string; class: ErrorClass; detail?: unknown }
