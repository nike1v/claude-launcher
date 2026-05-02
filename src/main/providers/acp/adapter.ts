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

  // True between sending session/load and receiving its response.
  // Opencode (and per spec, any compliant ACP server) emits the loaded
  // session's history as a series of session/update notifications
  // BEFORE the load response — replaying past user messages, agent
  // thoughts, and agent replies. We skip the synthetic turn.started
  // those updates would otherwise trigger so the renderer doesn't end
  // up with an unclosable busy state, and emit each replayed message
  // as a one-shot item rather than a streamed delta.
  private inLoadReplay = false

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

  // Queue session/new (or session/load on resume) — the next step
  // after either a successful authenticate or a skipped/no-op
  // authenticate. Centralised so the post-initialize and
  // post-authenticate code paths can share it without duplicating
  // the queue-and-flush logic.
  private openSessionAfterAuth(): void {
    if (this.resumeSessionId) {
      const id = this.allocateId('session.load')
      this.inLoadReplay = true
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
  }

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
      const err = msg.error as { message?: string; code?: number; data?: unknown }
      // authenticate is intentionally not implemented by opencode and
      // may be a no-op for other flavors that auth out-of-band. Don't
      // strand the bootstrap on its error response — if the agent has
      // a usable external auth, session/new will succeed and the user
      // is fine; if it doesn't, session/new errors and we surface
      // *that* as the visible failure instead of a misleading
      // "authenticate failed".
      if (pending.kind === 'authenticate') {
        this.openSessionAfterAuth()
        return
      }
      // session/load failure with "session not found" is the
      // common-and-recoverable case: cursor evicts old sessions, opencode
      // forgets after restart in some setups. Fall back to session/new
      // so the user lands in a fresh session instead of a tab stuck on
      // an unrecoverable error. They lose the prior history but keep a
      // working chat — and lastSessionRef will be repinned to the new
      // sessionId on session.started.
      if (pending.kind === 'session.load' && isSessionNotFound(err)) {
        this.inLoadReplay = false
        this.resumeSessionId = undefined
        out.push({
          kind: 'warning',
          message: `${this.flavor} could not resume the previous session — starting fresh.`,
          detail: err
        })
        const newId = this.allocateId('session.new')
        this.pendingWrites += jsonRpcRequest(newId, 'session/new', {
          cwd: this.startCwd,
          mcpServers: []
        })
        return
      }
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
      // opencode advertises an authMethod ("Login with opencode") but
      // its actual `authenticate` implementation rejects with
      // "Authentication not implemented" — auth is configured
      // externally via `opencode auth login`. So for opencode we skip
      // the authenticate step entirely and proceed straight to
      // session/new. Cursor's flow does need authenticate (cursor's
      // login methodId), so it keeps the original chain.
      if (this.flavor === 'opencode') {
        this.openSessionAfterAuth()
        return
      }
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
      this.openSessionAfterAuth()
      return
    }

    if (pending.kind === 'session.new' || pending.kind === 'session.load') {
      const sessionId = typeof result.sessionId === 'string' ? result.sessionId : null
      if (sessionId) {
        this.sessionId = sessionId
        // Replay finished. Reset the synthetic turn id we may have
        // bound replayed items to — the next live prompt should open a
        // fresh turn. Clearing currentAssistant/Reasoning item ids too
        // so a fresh assistant chunk after resume creates a new
        // bubble, not a continuation of the last replayed one.
        if (pending.kind === 'session.load') {
          this.inLoadReplay = false
          this.currentTurnId = null
          this.currentAssistantItemId = null
          this.currentReasoningItemId = null
        }
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
    // turn.started. Skip during inLoadReplay: opencode replays past
    // history through the same session/update notifications, but those
    // historical messages aren't a "turn" in the
    // user-pressed-send-and-is-waiting sense — synthesizing a
    // turn.started here would flip the session to busy and never close
    // (no turn.completed for replay), leaving the spinner stuck. The
    // replayed items still emit (just without a turnId binding); the
    // session/load response then markReady's the session normally.
    if (!this.inLoadReplay
      && this.currentTurnId === null
      && (variant === 'agent_message_chunk' || variant === 'agent_thought_chunk' || variant === 'tool_call')) {
      this.currentTurnId = `turn-${this.nextRequestId++}`
      out.push({ kind: 'turn.started', turnId: this.currentTurnId, model: this.startModel })
    }

    switch (variant) {
      case 'agent_message_chunk': {
        const content = (update.content ?? {}) as Record<string, unknown>
        const text = typeof content.text === 'string' ? content.text : ''
        if (!text) return
        // Use messageId as the stable item id when present so chunks
        // belonging to the same message append to one bubble. On a new
        // messageId (e.g. multiple historical messages in replay, or
        // the next live turn after the first), open a fresh item.
        const msgId = typeof update.messageId === 'string' ? update.messageId : null
        if (msgId !== null && this.currentAssistantItemId !== msgId) {
          this.currentAssistantItemId = msgId
          out.push({
            kind: 'item.started',
            itemId: this.currentAssistantItemId,
            turnId: this.currentTurnId ?? '',
            itemType: 'assistant_message',
            timestamp: Date.now()
          })
        } else if (this.currentAssistantItemId === null) {
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
        const msgId = typeof update.messageId === 'string' ? update.messageId : null
        if (msgId !== null && this.currentReasoningItemId !== msgId) {
          this.currentReasoningItemId = `reasoning-${msgId}`
          out.push({
            kind: 'item.started',
            itemId: this.currentReasoningItemId,
            turnId: this.currentTurnId ?? '',
            itemType: 'reasoning'
          })
        } else if (this.currentReasoningItemId === null) {
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

      case 'user_message_chunk': {
        // Only emitted during session/load history replay. Live user
        // messages come via session/prompt and are mirrored locally by
        // InputBar's optimistic push, so we'd duplicate the bubble if
        // we rendered them here. The inLoadReplay guard makes the
        // intent explicit.
        if (!this.inLoadReplay) return
        const content = (update.content ?? {}) as Record<string, unknown>
        const text = typeof content.text === 'string' ? content.text : ''
        if (!text) return
        const msgId = typeof update.messageId === 'string'
          ? update.messageId
          : `user-${this.nextRequestId++}`
        out.push({
          kind: 'item.started',
          itemId: msgId,
          turnId: this.currentTurnId ?? '',
          itemType: 'user_message',
          text,
          timestamp: Date.now()
        })
        out.push({ kind: 'item.completed', itemId: msgId, status: 'completed' })
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
        // Cosmetic / metadata — not rendered today.
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

// Match the cursor / opencode "session expired" error responses to
// session/load. Both report code -32602 (Invalid params) with a
// message containing "Session" and "not found" — checking the message
// substring is more robust than the exact format which has differed
// between server versions.
function isSessionNotFound(err: { code?: number; message?: string; data?: unknown }): boolean {
  const messages: string[] = []
  if (typeof err.message === 'string') messages.push(err.message)
  if (err.data && typeof err.data === 'object' && 'message' in err.data) {
    const m = (err.data as Record<string, unknown>).message
    if (typeof m === 'string') messages.push(m)
  }
  return messages.some(m => /session.*not found/i.test(m))
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
