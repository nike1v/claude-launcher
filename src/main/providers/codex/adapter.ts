// CodexAdapter — JSON-RPC client state machine for `codex app-server`.
//
// Wire format: JSON-RPC 2.0 over NDJSON stdio, with the `"jsonrpc": "2.0"`
// header omitted on the wire (per the upstream README / t3code's
// effect-codex-app-server/protocol.ts). Bidirectional — the server can
// also issue requests (approval prompts, user-input asks).
//
// Bootstrap chain we own internally; session-manager just spawns the
// child and pumps bytes:
//
//   1. spawn → startupBytes() → `initialize` request
//   2. parseChunk sees `initialize` response → queues `initialized`
//      notification + `thread/start` (or `thread/resume`) request
//   3. parseChunk sees `thread/started` notification → emits
//      session.started; the adapter is now ready for user turns
//   4. user message → formatUserMessage() → `turn/start` request
//   5. parseChunk dispatches per-turn notifications (item/started,
//      content deltas, item/completed, turn/completed) into
//      NormalizedEvents
//
// Interrupts go through formatControl({kind:'interrupt'}) → `turn/interrupt`
// request. Approvals are server-initiated requests we reply to from
// formatControl({kind:'approval', ...}) — the response id is the server
// request's id, captured in pendingServerRequests as approval prompts
// arrive.

import type { ApprovalDecision, ItemType, NormalizedEvent } from '../../../shared/events'
import type { SendAttachment } from '../../../shared/types'
import type { ControlCommand, IProviderAdapter, SpawnOpts } from '../types'

// Internal JSON-RPC bookkeeping. We allocate sequential request ids and
// remember what method each id is for so the response handler can route
// it (initialize result vs. thread/start result vs. turn/start result).
type PendingClientRequest =
  | { kind: 'initialize' }
  | { kind: 'thread.start' }
  | { kind: 'thread.resume' }
  | { kind: 'turn.start' }
  | { kind: 'turn.interrupt' }
  | { kind: 'other'; method: string }

// A server-initiated request we still owe a response to. Indexed by the
// request id the server picked. Used so formatControl({kind:'approval'})
// can locate the pending request from the requestId carried in our
// renderer-emitted request.opened event.
interface PendingServerRequest {
  method: string
  // Original itemId attached to the approval prompt — used to wire the
  // response decision into the NormalizedEvent stream when the server
  // resolves the prompt back to us.
  itemId?: string
}

export class CodexAdapter implements IProviderAdapter {
  private lineBuffer = ''
  private pendingWrites = ''
  private nextRequestId = 1
  private readonly pendingClient = new Map<number, PendingClientRequest>()
  private readonly pendingServer = new Map<string | number, PendingServerRequest>()

  // User messages typed before the thread/start response arrived. Codex
  // would error on turn/start with no threadId, AND wire-ordering
  // requires thread/start to land before any turn/start. Queue the
  // (text, attachments) tuples here; flush as proper turn/start
  // requests once the threadId is known.
  private readonly pendingUserMessages: Array<{ text: string; attachments: readonly SendAttachment[] }> = []

  // Captured during bootstrap so subsequent writes (turn/start,
  // turn/interrupt, approval responses) can address the right thread.
  private threadId: string | null = null
  private currentTurnId: string | null = null

  // Set on construction (resumeRef from SpawnOpts) so we know whether to
  // dispatch thread/start vs thread/resume after the initialize response.
  private resumeThreadId: string | undefined
  private startCwd: string | undefined
  private startModel: string | undefined

  // Adapters created by parseTranscript don't drive a real session —
  // they just translate offline rollout files. We skip the bootstrap
  // dance and ignore startup / async writes in that mode.
  private readonly mode: 'live' | 'replay'

  public constructor(mode: 'live' | 'replay' = 'live') {
    this.mode = mode
  }

  public startupBytes(opts: SpawnOpts): string {
    if (this.mode === 'replay') return ''
    this.resumeThreadId = opts.resumeRef
    this.startCwd = opts.cwd
    this.startModel = opts.model
    const id = this.nextRequestId++
    this.pendingClient.set(id, { kind: 'initialize' })
    return jsonRpcRequest(id, 'initialize', {
      clientInfo: { name: 'claude-launcher', version: '0.5.x' },
      capabilities: {}
    })
  }

  public drainPendingWrites(): string {
    const out = this.pendingWrites
    this.pendingWrites = ''
    return out
  }

  public formatUserMessage(text: string, attachments: readonly SendAttachment[]): string {
    if (this.threadId === null) {
      // Bootstrap hasn't completed yet — codex would error on
      // turn/start with no threadId, and we need thread/start to
      // wire-precede any turn/start. Buffer the typed message until
      // the thread/start response lands; flushPendingUserMessages
      // drains it then.
      this.pendingUserMessages.push({ text, attachments })
      return ''
    }
    return encodeTurnStart(this.allocateId('turn.start'), this.threadId, text, attachments, this.startModel)
  }

  public formatControl(cmd: ControlCommand): string | null {
    switch (cmd.kind) {
      case 'interrupt': {
        if (!this.threadId || !this.currentTurnId) return null
        return jsonRpcRequest(this.allocateId('turn.interrupt'), 'turn/interrupt', {
          threadId: this.threadId,
          turnId: this.currentTurnId
        })
      }
      case 'approval': {
        // The renderer's approval click carries the requestId that
        // originated from a server-initiated approval prompt. The
        // response goes back to that same request id.
        const pending = this.pendingServer.get(cmd.requestId)
        if (!pending) return null
        this.pendingServer.delete(cmd.requestId)
        const decision = mapApprovalDecision(pending.method, cmd.decision)
        return jsonRpcResponse(cmd.requestId, { decision })
      }
      case 'user-input-response': {
        // Server-initiated user-input prompt. Codex expects an `answers`
        // map keyed by question id.
        const pending = this.pendingServer.get(cmd.requestId)
        if (!pending) return null
        this.pendingServer.delete(cmd.requestId)
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
        out.push({ kind: 'warning', message: `codex emitted non-JSON line: ${truncate(trimmed, 200)}` })
        continue
      }
      this.dispatch(msg, out)
    }
    return out
  }

  public parseTranscript(content: string): NormalizedEvent[] {
    // Codex rollout files are JSONL of server notifications captured
    // during the original session. The dispatch path is the same; we
    // just don't drive any bootstrap.
    const replayAdapter = this.mode === 'replay' ? this : new CodexAdapter('replay')
    const out: NormalizedEvent[] = []
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const msg = JSON.parse(trimmed)
        replayAdapter.dispatch(msg, out)
      } catch {
        // skip
      }
    }
    return out
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private allocateId(kind: PendingClientRequest['kind'], method?: string): number {
    const id = this.nextRequestId++
    this.pendingClient.set(id, kind === 'other' ? { kind: 'other', method: method! } : { kind } as PendingClientRequest)
    return id
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
      const err = msg.error as { message?: string; code?: number }
      out.push({
        kind: 'error',
        message: `codex ${pending.kind} failed: ${err.message ?? 'unknown'}`,
        class: 'provider_error',
        detail: err
      })
      return
    }

    const result = (msg.result ?? {}) as Record<string, unknown>

    if (pending.kind === 'initialize') {
      // Send the `initialized` notification + the thread/start (or
      // resume) request. From now on, normal turns can flow.
      this.pendingWrites += jsonRpcNotification('initialized', {})
      if (this.resumeThreadId) {
        this.pendingWrites += jsonRpcRequest(
          this.allocateId('thread.resume'),
          'thread/resume',
          { threadId: this.resumeThreadId, cwd: this.startCwd, model: this.startModel }
        )
      } else {
        this.pendingWrites += jsonRpcRequest(
          this.allocateId('thread.start'),
          'thread/start',
          { cwd: this.startCwd, model: this.startModel }
        )
      }
      return
    }

    if (pending.kind === 'thread.start' || pending.kind === 'thread.resume') {
      const thread = (result.thread ?? {}) as Record<string, unknown>
      const threadId = typeof thread.id === 'string' ? thread.id : null
      if (threadId) {
        this.threadId = threadId
        // Flush any user messages typed during bootstrap, in order, as
        // proper turn/start requests now that we have the threadId.
        for (const queued of this.pendingUserMessages) {
          this.pendingWrites += encodeTurnStart(
            this.allocateId('turn.start'),
            threadId,
            queued.text,
            queued.attachments,
            this.startModel
          )
        }
        this.pendingUserMessages.length = 0
        // session.started fires from the `thread/started` notification
        // which usually arrives alongside the response — don't double
        // emit here.
      }
      return
    }

    if (pending.kind === 'turn.start') {
      const turn = (result.turn ?? {}) as Record<string, unknown>
      const turnId = typeof turn.id === 'string' ? turn.id : null
      if (turnId) this.currentTurnId = turnId
      return
    }

    // turn.interrupt + others — no follow-up.
  }

  private handleServerRequest(msg: Record<string, unknown>, out: NormalizedEvent[]): void {
    const id = msg.id as string | number
    const method = msg.method as string
    const params = (msg.params ?? {}) as Record<string, unknown>
    const itemId = typeof params.itemId === 'string' ? params.itemId : undefined

    let requestType: 'tool_approval' | 'command_approval' | 'file_change_approval' | 'unknown'
    if (method.includes('commandExecution') || method === 'execCommandApproval') {
      requestType = 'command_approval'
    } else if (method.includes('fileChange') || method === 'applyPatchApproval') {
      requestType = 'file_change_approval'
    } else if (method.includes('permissions')) {
      requestType = 'tool_approval'
    } else {
      requestType = 'unknown'
    }

    this.pendingServer.set(id, { method, itemId })
    out.push({
      kind: 'request.opened',
      requestId: String(id),
      itemId,
      requestType,
      payload: params
    })
  }

  private handleNotification(method: string, params: Record<string, unknown>, out: NormalizedEvent[]): void {
    switch (method) {
      case 'thread/started': {
        const thread = (params.thread ?? {}) as Record<string, unknown>
        const sessionRef = typeof thread.id === 'string' ? thread.id : (this.threadId ?? '')
        if (!sessionRef) return
        this.threadId = sessionRef
        out.push({
          kind: 'session.started',
          sessionRef,
          model: typeof thread.model === 'string' ? thread.model : undefined,
          cwd: typeof thread.cwd === 'string' ? thread.cwd : undefined
        })
        out.push({ kind: 'session.stateChanged', state: 'ready' })
        return
      }

      case 'thread/tokenUsage/updated': {
        const u = (params.tokenUsage ?? params.usage ?? {}) as Record<string, unknown>
        out.push({
          kind: 'tokenUsage.updated',
          usage: {
            inputTokens: numOpt(u.inputTokens),
            outputTokens: numOpt(u.outputTokens),
            cachedInputTokens: numOpt(u.cachedInputTokens),
            reasoningTokens: numOpt(u.reasoningTokens),
            contextWindow: numOpt(u.contextWindow ?? u.maxTokens)
          }
        })
        return
      }

      case 'turn/started': {
        const turn = (params.turn ?? {}) as Record<string, unknown>
        const turnId = typeof turn.id === 'string' ? turn.id : `turn-${this.nextRequestId++}`
        this.currentTurnId = turnId
        out.push({
          kind: 'turn.started',
          turnId,
          model: typeof turn.model === 'string' ? turn.model : this.startModel
        })
        return
      }

      case 'turn/completed': {
        const turn = (params.turn ?? {}) as Record<string, unknown>
        const turnId = typeof turn.id === 'string' ? turn.id : (this.currentTurnId ?? '')
        if (turnId === this.currentTurnId) this.currentTurnId = null
        out.push({
          kind: 'turn.completed',
          turnId,
          status: turn.error ? 'failed' : 'completed'
        })
        return
      }

      case 'turn/aborted': {
        const turn = (params.turn ?? {}) as Record<string, unknown>
        const turnId = typeof turn.id === 'string' ? turn.id : (this.currentTurnId ?? '')
        out.push({ kind: 'turn.completed', turnId, status: 'interrupted' })
        return
      }

      case 'item/started': {
        emitItemStarted(params, out, this.currentTurnId)
        return
      }

      case 'item/completed': {
        const item = (params.item ?? {}) as Record<string, unknown>
        const itemId = typeof item.id === 'string' ? item.id : ''
        if (!itemId) return
        const isError = !!item.error
        out.push({
          kind: 'item.completed',
          itemId,
          status: isError ? 'failed' : 'completed',
          output: extractItemOutput(item),
          isError
        })
        return
      }

      case 'item/agentMessage/delta': {
        const itemId = typeof params.itemId === 'string' ? params.itemId : ''
        const delta = typeof params.delta === 'string' ? params.delta : ''
        if (!itemId || !delta) return
        out.push({ kind: 'content.delta', itemId, streamKind: 'assistant_text', text: delta })
        return
      }

      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta': {
        const itemId = typeof params.itemId === 'string' ? params.itemId : ''
        const delta = typeof params.delta === 'string' ? params.delta : ''
        if (!itemId || !delta) return
        out.push({ kind: 'content.delta', itemId, streamKind: 'reasoning_text', text: delta })
        return
      }

      case 'item/commandExecution/outputDelta': {
        const itemId = typeof params.itemId === 'string' ? params.itemId : ''
        const chunk = typeof params.chunk === 'string' ? params.chunk : ''
        if (!itemId || !chunk) return
        out.push({ kind: 'content.delta', itemId, streamKind: 'command_output', text: chunk })
        return
      }

      case 'thread/closed':
      case 'thread/status/changed': {
        // Cosmetic — the renderer doesn't render anything for these,
        // but session.exited would fire if the session-manager observes
        // process exit.
        return
      }

      case 'serverRequest/resolved': {
        // The server confirmed it received our approval reply. Nothing
        // more to do; the request.resolved event was already emitted by
        // formatControl.
        return
      }

      case 'error': {
        const err = (params.error ?? {}) as Record<string, unknown>
        out.push({
          kind: 'error',
          message: typeof err.message === 'string' ? err.message : 'codex error',
          class: 'provider_error',
          detail: err
        })
        return
      }

      default:
        // Unknown notification — keep quiet, codex emits a long tail of
        // diagnostic / cosmetic events we don't render.
        return
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function jsonRpcRequest(id: number, method: string, params: unknown): string {
  return JSON.stringify({ id, method, params }) + '\n'
}

function jsonRpcNotification(method: string, params: unknown): string {
  return JSON.stringify({ method, params }) + '\n'
}

function jsonRpcResponse(id: string | number, result: unknown): string {
  return JSON.stringify({ id, result }) + '\n'
}

function encodeTurnStart(
  id: number,
  threadId: string,
  text: string,
  attachments: readonly SendAttachment[],
  model: string | undefined
): string {
  const input: object[] = []
  if (text) input.push({ type: 'text', text })
  for (const att of attachments) {
    if (att.kind === 'image') {
      input.push({ type: 'image', url: `data:${att.mediaType};base64,${att.data}` })
    } else if (att.kind === 'document') {
      // Codex doesn't have a first-class "document" content part. Fall
      // back to a localImage hint or an inline note — for now, drop
      // documents with a warning at send time isn't an option since
      // we're stateless here. Inline as text.
      input.push({ type: 'text', text: `[attachment: ${att.name} (${att.mediaType})]` })
    } else if (att.kind === 'text') {
      const fence = '```'
      input.push({ type: 'text', text: `${fence}${att.name}\n${att.text}\n${fence}` })
    }
  }
  return jsonRpcRequest(id, 'turn/start', {
    threadId,
    input,
    model
  })
}

function emitItemStarted(
  params: Record<string, unknown>,
  out: NormalizedEvent[],
  fallbackTurnId: string | null
): void {
  const item = (params.item ?? {}) as Record<string, unknown>
  const itemId = typeof item.id === 'string' ? item.id : ''
  if (!itemId) return
  const turnId = typeof params.turnId === 'string' ? params.turnId : (fallbackTurnId ?? '')
  if (!turnId) return

  const itemType = mapItemType(typeof item.type === 'string' ? item.type : 'unknown')

  switch (itemType) {
    case 'assistant_message':
    case 'reasoning':
      out.push({ kind: 'item.started', itemId, turnId, itemType })
      break
    case 'user_message':
      out.push({
        kind: 'item.started',
        itemId,
        turnId,
        itemType,
        text: typeof item.text === 'string' ? item.text : ''
      })
      break
    case 'tool_use':
      out.push({
        kind: 'item.started',
        itemId,
        turnId,
        itemType,
        name: typeof item.name === 'string' ? item.name : 'mcp_tool',
        input: item.input ?? {}
      })
      break
    case 'command_execution':
      out.push({
        kind: 'item.started',
        itemId,
        turnId,
        itemType,
        command: typeof item.command === 'string' ? item.command : '',
        cwd: typeof item.cwd === 'string' ? item.cwd : undefined
      })
      break
    case 'file_change':
      out.push({
        kind: 'item.started',
        itemId,
        turnId,
        itemType,
        path: typeof item.path === 'string' ? item.path : '',
        mode: mapFileChangeMode(item.mode)
      })
      break
    case 'web_search':
      out.push({
        kind: 'item.started',
        itemId,
        turnId,
        itemType,
        query: typeof item.query === 'string' ? item.query : undefined
      })
      break
    default:
      out.push({ kind: 'item.started', itemId, turnId, itemType: 'unknown' })
  }
}

function mapItemType(codexType: string): ItemType {
  switch (codexType) {
    case 'agentMessage': return 'assistant_message'
    case 'userMessage': return 'user_message'
    case 'reasoning': return 'reasoning'
    case 'commandExecution': return 'command_execution'
    case 'fileChange': return 'file_change'
    case 'mcpToolCall':
    case 'dynamicToolCall': return 'tool_use'
    case 'webSearch': return 'web_search'
    case 'plan': return 'plan'
    default: return 'unknown'
  }
}

function mapFileChangeMode(raw: unknown): 'create' | 'edit' | 'delete' | undefined {
  if (raw === 'create' || raw === 'edit' || raw === 'delete') return raw
  return undefined
}

// Codex approval responses use different vocabularies per request type.
// Map our four-state ApprovalDecision onto the codex string values. See
// CommandExecutionRequestApprovalResponse / FileChangeRequestApprovalResponse
// in t3code's effect-codex-app-server schema.
function mapApprovalDecision(method: string, decision: ApprovalDecision): string {
  const isFileChange = method.includes('fileChange') || method === 'applyPatchApproval'
  if (isFileChange) {
    switch (decision) {
      case 'accept': return 'approve'
      case 'acceptForSession': return 'approve_for_session'
      case 'decline': return 'deny'
      case 'cancel': return 'abort'
    }
  }
  // commandExecution / generic
  switch (decision) {
    case 'accept': return 'approved'
    case 'acceptForSession': return 'approved_for_session'
    case 'decline': return 'denied'
    case 'cancel': return 'abort'
  }
}

function extractItemOutput(item: Record<string, unknown>): string | undefined {
  if (typeof item.output === 'string') return item.output
  if (typeof item.text === 'string') return item.text
  if (typeof item.stdout === 'string') return item.stdout
  return undefined
}

function numOpt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
