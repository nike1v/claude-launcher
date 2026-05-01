// AcpAdapter — JSON-RPC client state machine for the Agent Client
// Protocol (ACP) over NDJSON stdio. Used by both Cursor (`cursor agent
// acp`) and Opencode (`opencode acp`) — same wire format, near-
// identical method set, distinguished only by:
//
//   - the `authenticate.methodId` used in the handshake
//   - cursor's per-session extension methods (`cursor/ask_question`,
//     `cursor/create_plan`, `cursor/update_todos`, …) which opencode
//     doesn't emit
//   - cursor needs `session/set_config_option` after session/new to
//     pick a model; opencode picks its model elsewhere
//
// Bootstrap sequence we drive:
//
//   1. spawn → startupBytes() → `initialize` request (protocolVersion: 1)
//   2. parseChunk sees `initialize` response →
//      queue `authenticate { methodId }` request
//   3. parseChunk sees `authenticate` response →
//      queue `session/new` (fresh) or `session/load` (resume) request
//   4. parseChunk sees `session/new` / `session/load` response →
//      capture sessionId, emit session.started, flush queued user
//      messages as `session/prompt` requests
//
// Streaming during a turn arrives as `session/update` notifications
// keyed by `params.update.sessionUpdate` — we map each variant onto
// our NormalizedEvent union (item.started / content.delta /
// item.completed / etc).
//
// Permission asks are server-initiated `session/request_permission`
// requests carrying an `options[]` list; we store the options so
// formatControl({kind:'approval', decision}) can pick the
// `optionId` whose `kind` matches the user's decision.
//
// Auth caveat: opencode's authenticate is a pass-through — methodId
// doesn't matter, the underlying provider auth is configured outside
// the protocol via `opencode auth login`. Cursor expects the literal
// string `"cursor_login"` (or whatever its `initialize` response
// advertises) and then trusts the user already ran `agent login`.
// Both flavors surface a JSON-RPC error if auth fails; we forward
// it as a NormalizedEvent kind=error.

import type {
  ApprovalDecision,
  ItemType,
  NormalizedEvent,
  UserAttachment
} from '../../../shared/events'
import type { SendAttachment } from '../../../shared/types'
import type { ControlCommand, IProviderAdapter, SpawnOpts } from '../types'

export type AcpFlavor = 'cursor' | 'opencode'

type PendingClientRequest =
  | { kind: 'initialize' }
  | { kind: 'authenticate' }
  | { kind: 'session.new' }
  | { kind: 'session.load' }
  | { kind: 'session.prompt' }
  | { kind: 'session.set_config_option' }
  | { kind: 'other'; method: string }

interface PermissionOption {
  optionId: string
  name?: string
  kind?: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | string
}

interface PendingServerRequest {
  method: string
  // For session/request_permission: the option list so we can map
  // ApprovalDecision back to one of these option ids.
  options?: PermissionOption[]
  // For cursor/ask_question: the question schema (so the renderer's
  // user-input flow can render it).
  itemId?: string
}

export class AcpAdapter implements IProviderAdapter {
  private readonly flavor: AcpFlavor
  private readonly mode: 'live' | 'replay'

  private lineBuffer = ''
  private pendingWrites = ''
  private nextRequestId = 1
  private readonly pendingClient = new Map<number, PendingClientRequest>()
  private readonly pendingServer = new Map<string | number, PendingServerRequest>()

  // Session state captured during bootstrap.
  private sessionId: string | null = null
  private resumeSessionId: string | undefined
  private startCwd: string | undefined
  private startModel: string | undefined

  // Auth method id selected after the initialize response. ACP says
  // the agent advertises authMethods[]; we use the first one whose
  // id matches our flavor's preference (or fall back to the first
  // one). Saved here so the authenticate response handler knows what
  // it's responding to.
  private authMethodId: string | null = null

  // User messages typed before the session is ready. We can't issue
  // session/prompt without a sessionId, so queue and flush after
  // session/new lands.
  private readonly pendingUserMessages: Array<{ text: string; attachments: readonly SendAttachment[] }> = []

  // Synthesized turn id — ACP's session/prompt has its own id but
  // doesn't expose a "turn" concept. We synthesize a turnId for
  // each prompt round so item.started can carry it; the renderer
  // doesn't really use turnId but other code paths do.
  private currentTurnId: string | null = null

  // Active item id so multi-chunk content.delta has somewhere to
  // anchor when the agent emits agent_message_chunk without first
  // emitting an item.started. ACP doesn't fire an explicit start
  // for the assistant message stream; the first chunk implicitly
  // starts one.
  private currentAssistantItemId: string | null = null
  private currentReasoningItemId: string | null = null

  public constructor(flavor: AcpFlavor, mode: 'live' | 'replay' = 'live') {
    this.flavor = flavor
    this.mode = mode
  }

  // ── IProviderAdapter ──────────────────────────────────────────────────

  public startupBytes(opts: SpawnOpts): string {
    if (this.mode === 'replay') return ''
    this.resumeSessionId = opts.resumeRef
    this.startCwd = opts.cwd
    this.startModel = opts.model
    const id = this.nextRequestId++
    this.pendingClient.set(id, { kind: 'initialize' })
    return jsonRpcRequest(id, 'initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'claude-launcher', version: '0.5.x' },
      // Decline filesystem / terminal back-requests — the agents
      // execute their own tools when these are off, which is the
      // saner default for a launcher that's not also a terminal.
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false
      }
    })
  }

  public drainPendingWrites(): string {
    const out = this.pendingWrites
    this.pendingWrites = ''
    return out
  }

  public formatUserMessage(text: string, attachments: readonly SendAttachment[]): string {
    if (this.sessionId === null) {
      this.pendingUserMessages.push({ text, attachments })
      return ''
    }
    return this.encodePrompt(this.sessionId, text, attachments)
  }

  public formatControl(cmd: ControlCommand): string | null {
    switch (cmd.kind) {
      case 'interrupt': {
        if (!this.sessionId) return null
        // session/cancel is a notification (no id, no response).
        return jsonRpcNotification('session/cancel', { sessionId: this.sessionId })
      }
      case 'approval': {
        const pending = this.pendingServer.get(cmd.requestId)
        if (!pending || !pending.options) return null
        this.pendingServer.delete(cmd.requestId)
        const optionId = pickPermissionOptionId(pending.options, cmd.decision)
        if (cmd.decision === 'cancel') {
          return jsonRpcResponse(cmd.requestId, { outcome: { outcome: 'cancelled' } })
        }
        return jsonRpcResponse(cmd.requestId, {
          outcome: { outcome: 'selected', selectedOptionId: optionId }
        })
      }
      case 'user-input-response': {
        const pending = this.pendingServer.get(cmd.requestId)
        if (!pending) return null
        this.pendingServer.delete(cmd.requestId)
        // Cursor's ask_question expects { answers: { [questionId]: optionIds[] } }.
        return jsonRpcResponse(cmd.requestId, { answers: cmd.answers })
      }
    }
  }

  public parseChunk(chunk: string): NormalizedEvent[] {
    this.lineBuffer += chunk
    const lines = this.lineBuffer.split('\n')
    this.lineBuffer = lines.pop() ?? ''
    const out: NormalizedEvent[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let msg: unknown
      try { msg = JSON.parse(trimmed) }
      catch {
        out.push({ kind: 'warning', message: `${this.flavor} emitted non-JSON line: ${truncate(trimmed, 200)}` })
        continue
      }
      this.dispatch(msg, out)
    }
    return out
  }

  public parseTranscript(_content: string): NormalizedEvent[] {
    // Neither cursor nor opencode exposes a JSONL rollout file in a
    // protocol-stable format. Backfill from disk would have to go
    // through opencode's HTTP API or read cursor's session files
    // directly — both out of scope for this PR. A fresh-resume via
    // session/load picks up state from the agent's own storage
    // anyway.
    return []
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private dispatch(msg: unknown, out: NormalizedEvent[]): void {
    if (!msg || typeof msg !== 'object') return
    const obj = msg as Record<string, unknown>

    // Response to one of OUR client requests (has id, no method).
    if (typeof obj.id !== 'undefined' && typeof obj.method === 'undefined') {
      this.handleResponse(obj, out)
      return
    }

    // Server-initiated request (has id AND method).
    if (typeof obj.id !== 'undefined' && typeof obj.method === 'string') {
      this.handleServerRequest(obj, out)
      return
    }

    // Notification (has method, no id).
    if (typeof obj.method === 'string') {
      this.handleNotification(obj.method, (obj.params ?? {}) as Record<string, unknown>, out)
    }
  }

  private handleResponse(msg: Record<string, unknown>, out: NormalizedEvent[]): void {
    const id = msg.id as number
    const pending = this.pendingClient.get(id)
    if (!pending) return
    this.pendingClient.delete(id)

    if (msg.error) {
      const err = msg.error as { message?: string; code?: number }
      out.push({
        kind: 'error',
        message: `${this.flavor} ${pending.kind} failed: ${err.message ?? 'unknown'}`,
        class: 'provider_error',
        detail: err
      })
      return
    }

    const result = (msg.result ?? {}) as Record<string, unknown>

    if (pending.kind === 'initialize') {
      // Pick auth method. Both flavors advertise an authMethods[]
      // array; we want the one matching our flavor's preference.
      const authMethods = Array.isArray(result.authMethods)
        ? result.authMethods as Array<{ id?: string }>
        : []
      this.authMethodId = pickAuthMethodId(this.flavor, authMethods)
      const id = this.allocateId('authenticate')
      this.pendingWrites += jsonRpcRequest(id, 'authenticate', {
        methodId: this.authMethodId
      })
      return
    }

    if (pending.kind === 'authenticate') {
      // Auth ok (or pass-through). Open the session.
      if (this.resumeSessionId) {
        const id = this.allocateId('session.load')
        this.pendingWrites += jsonRpcRequest(id, 'session/load', {
          sessionId: this.resumeSessionId,
          cwd: this.startCwd,
          mcpServers: []
        })
      } else {
        const id = this.allocateId('session.new')
        this.pendingWrites += jsonRpcRequest(id, 'session/new', {
          cwd: this.startCwd,
          mcpServers: []
        })
      }
      return
    }

    if (pending.kind === 'session.new' || pending.kind === 'session.load') {
      const sessionId = typeof result.sessionId === 'string' ? result.sessionId : null
      if (sessionId) {
        this.sessionId = sessionId
        out.push({
          kind: 'session.started',
          sessionRef: sessionId,
          model: this.startModel,
          cwd: this.startCwd
        })
        out.push({ kind: 'session.stateChanged', state: 'ready' })

        // Cursor needs `session/set_config_option` to pick the model.
        // For opencode the model is part of the agent's own config —
        // we don't try to influence it from the protocol.
        if (this.flavor === 'cursor' && this.startModel) {
          const optId = this.allocateId('session.set_config_option')
          this.pendingWrites += jsonRpcRequest(optId, 'session/set_config_option', {
            sessionId,
            configId: 'model',
            value: this.startModel
          })
        }

        // Flush queued user messages.
        for (const queued of this.pendingUserMessages) {
          this.pendingWrites += this.encodePrompt(sessionId, queued.text, queued.attachments)
        }
        this.pendingUserMessages.length = 0
      }
      return
    }

    if (pending.kind === 'session.prompt') {
      // The prompt-completion response carries the stopReason; we
      // synthesize a turn.completed off it. (ACP doesn't have
      // explicit turn lifecycle notifications.)
      if (this.currentTurnId) {
        const stopReason = typeof result.stopReason === 'string' ? result.stopReason : 'completed'
        out.push({
          kind: 'turn.completed',
          turnId: this.currentTurnId,
          status: stopReason === 'cancelled' ? 'interrupted' : 'completed'
        })
        this.currentTurnId = null
        this.currentAssistantItemId = null
        this.currentReasoningItemId = null
      }
      return
    }

    // session.set_config_option, others — no follow-up.
  }

  private handleServerRequest(msg: Record<string, unknown>, out: NormalizedEvent[]): void {
    const id = msg.id as string | number
    const method = msg.method as string
    const params = (msg.params ?? {}) as Record<string, unknown>

    if (method === 'session/request_permission') {
      const toolCall = (params.toolCall ?? {}) as Record<string, unknown>
      const itemId = typeof toolCall.toolCallId === 'string' ? toolCall.toolCallId : undefined
      const optionsRaw = Array.isArray(params.options) ? params.options as PermissionOption[] : []
      const requestType = mapToolKindToRequestType(typeof toolCall.kind === 'string' ? toolCall.kind : '')
      this.pendingServer.set(id, { method, options: optionsRaw, itemId })
      out.push({
        kind: 'request.opened',
        requestId: String(id),
        itemId,
        requestType,
        payload: params
      })
      return
    }

    if (this.flavor === 'cursor' && (method === 'cursor/ask_question' || method === 'cursor/create_plan')) {
      const itemId = typeof params.toolCallId === 'string' ? params.toolCallId : undefined
      this.pendingServer.set(id, { method, itemId })
      // ask_question maps to user-input flow; create_plan we treat
      // as an approval (it expects an empty {} reply, which is what
      // formatControl emits for cancel — the renderer can show a
      // "plan" card and the user clicks to acknowledge). For now
      // surface as request.opened with requestType:'unknown'.
      out.push({
        kind: 'request.opened',
        requestId: String(id),
        itemId,
        requestType: 'unknown',
        payload: params
      })
      return
    }

    // Unknown server request — auto-reply with an error so the agent
    // doesn't hang waiting on us. (Better than silently dropping.)
    this.pendingWrites += jsonRpcResponse(id, null, {
      code: -32601,
      message: `Method ${method} not supported by claude-launcher client`
    })
  }

  private handleNotification(method: string, params: Record<string, unknown>, out: NormalizedEvent[]): void {
    if (method === 'session/update') {
      this.handleSessionUpdate(params, out)
      return
    }

    // cursor/* notifications (cursor/update_todos, cursor/task,
    // cursor/generate_image) — non-blocking cosmetic updates we
    // don't render today.
    if (method.startsWith('cursor/')) {
      return
    }

    // Anything else — quietly drop.
  }

  private handleSessionUpdate(params: Record<string, unknown>, out: NormalizedEvent[]): void {
    const update = (params.update ?? {}) as Record<string, unknown>
    const variant = typeof update.sessionUpdate === 'string' ? update.sessionUpdate : ''

    // First content arriving means a turn has started — synthesize
    // turn.started.
    if (this.currentTurnId === null && (variant === 'agent_message_chunk' || variant === 'agent_thought_chunk' || variant === 'tool_call')) {
      this.currentTurnId = `turn-${this.nextRequestId++}`
      out.push({ kind: 'turn.started', turnId: this.currentTurnId, model: this.startModel })
    }

    switch (variant) {
      case 'agent_message_chunk': {
        const content = (update.content ?? {}) as Record<string, unknown>
        const text = typeof content.text === 'string' ? content.text : ''
        if (!text) return
        if (this.currentAssistantItemId === null) {
          this.currentAssistantItemId = `msg-${this.nextRequestId++}`
          out.push({
            kind: 'item.started',
            itemId: this.currentAssistantItemId,
            turnId: this.currentTurnId ?? '',
            itemType: 'assistant_message',
            timestamp: Date.now()
          })
        }
        out.push({
          kind: 'content.delta',
          itemId: this.currentAssistantItemId,
          streamKind: 'assistant_text',
          text
        })
        return
      }

      case 'agent_thought_chunk': {
        const content = (update.content ?? {}) as Record<string, unknown>
        const text = typeof content.text === 'string' ? content.text : ''
        if (!text) return
        if (this.currentReasoningItemId === null) {
          this.currentReasoningItemId = `reasoning-${this.nextRequestId++}`
          out.push({
            kind: 'item.started',
            itemId: this.currentReasoningItemId,
            turnId: this.currentTurnId ?? '',
            itemType: 'reasoning'
          })
        }
        out.push({
          kind: 'content.delta',
          itemId: this.currentReasoningItemId,
          streamKind: 'reasoning_text',
          text
        })
        return
      }

      case 'tool_call': {
        const itemId = typeof update.toolCallId === 'string' ? update.toolCallId : ''
        if (!itemId) return
        const kind = typeof update.kind === 'string' ? update.kind : 'other'
        const name = typeof update.title === 'string' ? update.title : kind
        const input = update.rawInput ?? {}
        const itemType = mapAcpToolKindToItemType(kind)
        if (itemType === 'tool_use') {
          out.push({
            kind: 'item.started',
            itemId,
            turnId: this.currentTurnId ?? '',
            itemType: 'tool_use',
            name,
            input
          })
        } else if (itemType === 'command_execution') {
          out.push({
            kind: 'item.started',
            itemId,
            turnId: this.currentTurnId ?? '',
            itemType: 'command_execution',
            command: typeof input === 'object' && input && 'command' in input ? String((input as Record<string, unknown>).command ?? '') : name
          })
        } else if (itemType === 'file_change') {
          out.push({
            kind: 'item.started',
            itemId,
            turnId: this.currentTurnId ?? '',
            itemType: 'file_change',
            path: typeof input === 'object' && input && 'path' in input ? String((input as Record<string, unknown>).path ?? '') : name,
            mode: mapFileChangeMode(kind)
          })
        }
        // status: pending|in_progress on first emit is normal —
        // wait for tool_call_update to fire item.completed.
        return
      }

      case 'tool_call_update': {
        const itemId = typeof update.toolCallId === 'string' ? update.toolCallId : ''
        if (!itemId) return
        const status = typeof update.status === 'string' ? update.status : ''
        if (status === 'completed' || status === 'failed') {
          out.push({
            kind: 'item.completed',
            itemId,
            status: status === 'failed' ? 'failed' : 'completed',
            output: extractToolOutput(update),
            isError: status === 'failed'
          })
        }
        return
      }

      case 'usage_update': {
        // Opencode-specific. {used, size, cost: {amount, currency}}
        out.push({
          kind: 'tokenUsage.updated',
          usage: {
            inputTokens: numOpt(update.used),
            contextWindow: numOpt(update.size)
          }
        })
        return
      }

      case 'plan':
      case 'available_commands_update':
      case 'current_mode_update':
      case 'user_message_chunk':
        // Cosmetic / echo — not rendered today.
        return

      default:
        return
    }
  }

  private encodePrompt(sessionId: string, text: string, attachments: readonly SendAttachment[]): string {
    const id = this.allocateId('session.prompt')
    const prompt: object[] = []
    if (text) prompt.push({ type: 'text', text })
    for (const att of attachments) {
      if (att.kind === 'image') {
        prompt.push({ type: 'image', data: att.data, mimeType: att.mediaType })
      } else if (att.kind === 'document') {
        prompt.push({ type: 'text', text: `[document: ${att.name} (${att.mediaType})]` })
      } else if (att.kind === 'text') {
        const fence = '```'
        prompt.push({ type: 'text', text: `${fence}${att.name}\n${att.text}\n${fence}` })
      }
    }
    return jsonRpcRequest(id, 'session/prompt', { sessionId, prompt })
  }

  private allocateId(kind: PendingClientRequest['kind']): number {
    const id = this.nextRequestId++
    this.pendingClient.set(id, { kind } as PendingClientRequest)
    return id
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function jsonRpcRequest(id: number, method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
}

function jsonRpcNotification(method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'
}

function jsonRpcResponse(id: string | number, result: unknown, error?: { code: number; message: string }): string {
  if (error) {
    return JSON.stringify({ jsonrpc: '2.0', id, error }) + '\n'
  }
  return JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'
}

function pickAuthMethodId(flavor: AcpFlavor, authMethods: Array<{ id?: string }>): string {
  if (flavor === 'cursor') {
    const cursorLogin = authMethods.find(m => m.id === 'cursor_login')
    if (cursorLogin?.id) return cursorLogin.id
  }
  // Opencode (and cursor as fallback): take the first advertised
  // method. Opencode treats authenticate as a pass-through, so any
  // id works.
  return authMethods[0]?.id ?? 'default'
}

function pickPermissionOptionId(options: PermissionOption[], decision: ApprovalDecision): string {
  const wantedKind = decision === 'accept' ? 'allow_once'
    : decision === 'acceptForSession' ? 'allow_always'
    : decision === 'decline' ? 'reject_once'
    : 'reject_always'
  const match = options.find(o => o.kind === wantedKind)
  if (match) return match.optionId
  // Fall back to the first option of the right "approval direction".
  if (decision === 'accept' || decision === 'acceptForSession') {
    return options.find(o => o.kind?.startsWith('allow_'))?.optionId ?? options[0]?.optionId ?? ''
  }
  return options.find(o => o.kind?.startsWith('reject_'))?.optionId ?? options[0]?.optionId ?? ''
}

function mapToolKindToRequestType(kind: string): 'tool_approval' | 'command_approval' | 'file_change_approval' | 'unknown' {
  if (kind === 'execute') return 'command_approval'
  if (kind === 'edit' || kind === 'delete' || kind === 'move') return 'file_change_approval'
  if (kind === 'read' || kind === 'search' || kind === 'fetch' || kind === 'think' || kind === 'other') return 'tool_approval'
  return 'unknown'
}

function mapAcpToolKindToItemType(kind: string): ItemType {
  if (kind === 'execute') return 'command_execution'
  if (kind === 'edit' || kind === 'delete' || kind === 'move') return 'file_change'
  if (kind === 'read' || kind === 'search' || kind === 'fetch' || kind === 'think' || kind === 'other') return 'tool_use'
  return 'unknown'
}

function mapFileChangeMode(kind: string): 'create' | 'edit' | 'delete' | undefined {
  if (kind === 'edit') return 'edit'
  if (kind === 'delete') return 'delete'
  return undefined
}

function extractToolOutput(update: Record<string, unknown>): string | undefined {
  if (typeof update.rawOutput === 'string') return update.rawOutput
  const content = update.content
  if (Array.isArray(content)) {
    const texts: string[] = []
    for (const c of content) {
      if (c && typeof c === 'object' && 'text' in c && typeof (c as Record<string, unknown>).text === 'string') {
        texts.push(String((c as Record<string, unknown>).text))
      }
    }
    if (texts.length) return texts.join('\n')
  }
  return undefined
}

function numOpt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

// Unused export to keep the type exported for cursor/opencode providers.
export type _ProviderAttachmentBag = readonly UserAttachment[]
