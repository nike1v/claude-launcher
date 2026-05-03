// ClaudeAdapter — translates claude's `--output-format stream-json` line
// format into NormalizedEvent. Stateful per instance: each session
// (and each transcript replay) gets its own adapter so state doesn't
// leak across.
//
// Stream-json shape:
//   { type: 'system', subtype: 'init', session_id, model, cwd, ... }
//   { type: 'assistant', message: { content: [text|thinking|tool_use], usage } }
//   { type: 'user',      message: { content: string | (text|tool_result|image|document)[] } }
//   { type: 'result',    session_id, modelUsage, ... }
//
// Mapping:
//   system.init     → session.started + session.stateChanged(ready)
//   assistant block → item.started + content.delta(full text) + item.completed
//                     (one triple per block; tool_use items wait for matching
//                      tool_result before item.completed fires)
//   user (live)     → echo of what the renderer already pushed; dropped
//                     except tool_results, which complete pending tool items
//   user (replay)   → emitted as user_message item.started + item.completed
//                     plus tool_result completions
//   result          → tokenUsage.updated + turn.completed (closes turn opened
//                     by the first assistant event of this turn)

import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import type {
  AssistantEvent,
  ContentBlock,
  DocumentBlock,
  ImageBlock,
  ResultEvent,
  SendAttachment,
  StreamJsonEvent,
  ToolResultBlock,
  UserContentBlock,
  UserEvent
} from '../../../shared/types'
import type { ControlCommand, IProviderAdapter, SpawnOpts } from '../types'
import type { ItemStatus, NormalizedEvent, UserAttachment } from '../../../shared/events'
import { parseStreamJsonLine } from '../../stream-json-parser'
import { acpLog } from '../../acp-debug-log'

export class ClaudeAdapter implements IProviderAdapter {
  // Live mode: drop user-message echoes (the renderer already pushed
  // them locally via InputBar). Replay mode (transcripts): emit user
  // messages as items because there's no local push.
  private readonly mode: 'live' | 'replay'
  // Tag for wire-log lines so a paste from the user can be matched
  // across rx/tx without us threading sessionId through the adapter
  // constructor. New per adapter instance — ie per session.
  private readonly logTag = `claude-${Math.random().toString(36).slice(2, 8)}`

  private lineBuffer = ''
  // Current open turn. Opened on the first assistant event of a turn,
  // closed by the result event.
  private openTurnId: string | null = null
  // Tool-use blocks claude emitted that are awaiting their tool_result
  // (which arrives in a subsequent user event). Maps tool_use.id → itemId.
  private readonly pendingToolItems = new Map<string, string>()

  public constructor(mode: 'live' | 'replay' = 'live') {
    this.mode = mode
  }

  // Stateless protocols write nothing on startup. claude is ready for
  // stream-json input the moment it spawns.
  public startupBytes(_opts: SpawnOpts): string {
    return ''
  }

  // claude's adapter never queues async writes — every message it
  // sends is driven directly by formatUserMessage / formatControl.
  public drainPendingWrites(): string {
    return ''
  }

  public formatUserMessage(text: string, attachments: readonly SendAttachment[]): string {
    const content = attachments.length === 0
      ? text
      : buildContentBlocks(text, attachments)
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content }
    })
    acpLog('tx', this.logTag, 'claude', line)
    return line + '\n'
  }

  public formatControl(cmd: ControlCommand): string | null {
    switch (cmd.kind) {
      case 'interrupt': {
        // claude's stream-json control protocol: write a control_request
        // with subtype 'interrupt'. claude responds with control_response
        // (which we don't track — the next assistant/result event will
        // confirm the turn ended).
        const line = JSON.stringify({
          type: 'control_request',
          request_id: `req_${randomUUID()}`,
          request: { subtype: 'interrupt' }
        })
        acpLog('tx', this.logTag, 'claude', line)
        return line + '\n'
      }

      case 'approval': {
        // Claude's permission-prompt-tool stdio flow: reply with a user
        // message carrying a tool_result block. Claude itself only
        // recognises allow/deny today, so acceptForSession collapses to
        // accept and cancel collapses to decline. When claude grows a
        // session-scoped "always allow", route via the /permissions
        // config rather than collapsing here.
        const allow = cmd.decision === 'accept' || cmd.decision === 'acceptForSession'
        const line = JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: cmd.requestId,
              content: allow ? 'allow' : 'deny'
            }]
          }
        })
        acpLog('tx', this.logTag, 'claude', line)
        return line + '\n'
      }

      case 'user-input-response':
        // claude has no structured user-input flow today. Returning null
        // signals session-manager that there's no in-band command to
        // write — the request silently no-ops on this provider.
        return null
    }
  }

  public parseChunk(chunk: string): NormalizedEvent[] {
    this.lineBuffer += chunk
    const lines = this.lineBuffer.split('\n')
    this.lineBuffer = lines.pop() ?? ''
    const out: NormalizedEvent[] = []
    for (const line of lines) {
      if (line.trim()) acpLog('rx', this.logTag, 'claude', line)
      const event = parseStreamJsonLine(line)
      // Live stream-json doesn't carry timestamps; stamping at parse
      // time is accurate within sub-second of when claude printed the
      // line. Replay path extracts the real ISO timestamp from the
      // JSONL line below.
      if (event) this.translate(event, out, Date.now())
    }
    return out
  }

  public parseTranscript(content: string): NormalizedEvent[] {
    // Transcripts are JSONL files claude wrote — parsed line by line.
    // We force replay semantics for this call regardless of mode so
    // user-message items render in the backfill.
    const replayAdapter = this.mode === 'replay' ? this : new ClaudeAdapter('replay')
    const out: NormalizedEvent[] = []
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const event = parseStreamJsonLine(trimmed)
      if (!event) continue
      // JSONL lines carry an ISO timestamp written when claude saved
      // the message; that's the right value to display, not the
      // replay-time wall clock.
      const ts = extractJsonlTimestamp(trimmed) ?? Date.now()
      replayAdapter.translate(event, out, ts)
    }
    return out
  }

  // ── Translation ────────────────────────────────────────────────────────

  private translate(event: StreamJsonEvent, out: NormalizedEvent[], timestamp: number): void {
    if (event.type === 'system' && event.subtype === 'init') {
      out.push({
        kind: 'session.started',
        sessionRef: event.session_id,
        model: event.model,
        cwd: event.cwd
      })
      // Live: session-manager flips status to ready on this. Replay
      // skips it — the session is already running by the time we replay
      // its transcript, the live status flow is unaffected.
      if (this.mode === 'live') {
        out.push({ kind: 'session.stateChanged', state: 'ready' })
      }
      return
    }

    if (event.type === 'assistant') {
      this.translateAssistant(event, out, timestamp)
      return
    }

    if (event.type === 'user') {
      this.translateUser(event, out, timestamp)
      return
    }

    if (event.type === 'result') {
      this.translateResult(event, out)
      return
    }
  }

  private ensureTurn(out: NormalizedEvent[], model?: string): string {
    if (this.openTurnId) return this.openTurnId
    const turnId = `turn-${randomUUID()}`
    this.openTurnId = turnId
    // Replay skips turn.started — the renderer doesn't group items by
    // turnId and the StatusBar's busy/ready state is driven by live
    // status IPC, not transcript playback. Cuts ~60 events from a 30-
    // turn transcript. Live keeps the event so session-manager can flip
    // the spinner on each turn.
    if (this.mode === 'live') {
      out.push({ kind: 'turn.started', turnId, model })
    }
    return turnId
  }

  private translateAssistant(event: AssistantEvent, out: NormalizedEvent[], timestamp: number): void {
    const turnId = this.ensureTurn(out, event.message.model)
    const isReplay = this.mode === 'replay'

    // Per-call usage snapshot — live only. StatusBar reads the most
    // recent tokenUsage.updated for the context-fill meter; transcripts
    // don't drive that (the meter falls back to cached lastContextWindow
    // on the project).
    if (!isReplay) {
      const u = event.message.usage
      if (u) {
        out.push({
          kind: 'tokenUsage.updated',
          usage: {
            inputTokens: u.input_tokens,
            outputTokens: u.output_tokens,
            cachedInputTokens: (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
          }
        })
      }
    }

    for (const block of event.message.content) {
      if (block.type === 'text') {
        if (!block.text.trim()) continue
        const itemId = `text-${randomUUID()}`
        if (isReplay) {
          // Replay: text is whole already. One event with text inline.
          out.push({ kind: 'item.started', itemId, turnId, itemType: 'assistant_message', text: block.text, timestamp })
        } else {
          // Live: keep the start/delta/complete shape so streaming
          // providers (codex) can plug in without us revisiting this.
          out.push({ kind: 'item.started', itemId, turnId, itemType: 'assistant_message', timestamp })
          out.push({ kind: 'content.delta', itemId, streamKind: 'assistant_text', text: block.text })
          out.push({ kind: 'item.completed', itemId, status: 'completed' })
        }
        continue
      }
      if (block.type === 'thinking') {
        const itemId = `think-${randomUUID()}`
        if (isReplay) {
          out.push({ kind: 'item.started', itemId, turnId, itemType: 'reasoning', text: block.thinking })
        } else {
          out.push({ kind: 'item.started', itemId, turnId, itemType: 'reasoning' })
          out.push({ kind: 'content.delta', itemId, streamKind: 'reasoning_text', text: block.thinking })
          out.push({ kind: 'item.completed', itemId, status: 'completed' })
        }
        continue
      }
      if (block.type === 'tool_use') {
        // tool_use items keep the item.started → item.completed pattern
        // in both modes — the result arrives separately in a later
        // user event and needs to find an open item to attach to.
        const itemId = block.id
        this.pendingToolItems.set(block.id, itemId)
        out.push({
          kind: 'item.started',
          itemId,
          turnId,
          itemType: 'tool_use',
          name: block.name,
          input: block.input
        })
        continue
      }
    }
  }

  private translateUser(event: UserEvent, out: NormalizedEvent[], timestamp: number): void {
    const content = event.message.content

    if (typeof content === 'string') {
      // Live: the renderer already pushed a local user_message item via
      // InputBar — drop the wire echo.
      // Replay: this is the user's prompt from the transcript. user_message
      // items don't track completion state in the renderer, so item.started
      // alone is enough.
      if (this.mode === 'replay' && content.trim()) {
        const turnId = this.ensureTurn(out)
        const itemId = `user-${randomUUID()}`
        out.push({ kind: 'item.started', itemId, turnId, itemType: 'user_message', text: content, timestamp })
      }
      return
    }

    // Array content. Sort blocks into tool_results vs prompt blocks.
    const toolResults: ToolResultBlock[] = []
    const promptText: string[] = []
    const promptAttachments: UserAttachment[] = []

    for (const block of content) {
      if (block.type === 'tool_result') {
        toolResults.push(block)
        continue
      }
      if (block.type === 'text') {
        promptText.push(block.text)
        continue
      }
      if (block.type === 'image' || block.type === 'document') {
        promptAttachments.push(blockToAttachment(block))
        continue
      }
    }

    // Tool results — complete the matching pending tool_use items.
    for (const tr of toolResults) {
      const itemId = this.pendingToolItems.get(tr.tool_use_id) ?? tr.tool_use_id
      this.pendingToolItems.delete(tr.tool_use_id)
      const status: ItemStatus = tr.is_error ? 'failed' : 'completed'
      out.push({
        kind: 'item.completed',
        itemId,
        status,
        output: extractToolResultText(tr),
        isError: tr.is_error === true
      })
    }

    // Prompt blocks (text + attachments). Only emit a user_message
    // item in replay mode — live sees these as echoes of what InputBar
    // already pushed locally. No item.completed: user items don't track
    // completion in the renderer.
    const text = promptText.join('\n').trim()
    const hasPrompt = text.length > 0 || promptAttachments.length > 0
    if (hasPrompt && this.mode === 'replay') {
      const turnId = this.ensureTurn(out)
      const itemId = `user-${randomUUID()}`
      out.push({
        kind: 'item.started',
        itemId,
        turnId,
        itemType: 'user_message',
        text,
        attachments: promptAttachments.length ? promptAttachments : undefined,
        timestamp
      })
    }
  }

  private translateResult(event: ResultEvent, out: NormalizedEvent[]): void {
    const isReplay = this.mode === 'replay'

    if (!isReplay) {
      // Pull contextWindow off the first modelUsage entry. Claude reports
      // one entry per model used in the turn — for single-model turns
      // there's just one to pick.
      let contextWindow: number | undefined
      if (event.modelUsage) {
        for (const v of Object.values(event.modelUsage)) {
          if (v?.contextWindow) { contextWindow = v.contextWindow; break }
        }
      }
      if (contextWindow !== undefined) {
        out.push({ kind: 'tokenUsage.updated', usage: { contextWindow } })
      }
    }

    if (this.openTurnId) {
      const turnId = this.openTurnId
      this.openTurnId = null
      // Replay skips turn.completed — see ensureTurn.
      if (isReplay) return
      out.push({
        kind: 'turn.completed',
        turnId,
        status: event.is_error ? 'failed' : 'completed'
      })
    }
  }
}

// Pull the ISO8601 timestamp claude writes on every JSONL line so a
// transcript replay can render the original message times instead of
// the current wall clock. Live stream-json doesn't include this field —
// timestamps for live events are stamped at parseChunk time.
function extractJsonlTimestamp(line: string): number | undefined {
  try {
    const obj = JSON.parse(line) as unknown
    if (obj && typeof obj === 'object' && 'timestamp' in obj) {
      const t = (obj as { timestamp: unknown }).timestamp
      if (typeof t === 'string') {
        const ms = Date.parse(t)
        return Number.isNaN(ms) ? undefined : ms
      }
    }
  } catch {
    // Unparseable line — caller already discarded it via parseStreamJsonLine.
  }
  return undefined
}

function blockToAttachment(block: ImageBlock | DocumentBlock): UserAttachment {
  if (block.type === 'image') {
    return { kind: 'image', mediaType: block.source.media_type, data: block.source.data }
  }
  // DocumentBlock — names aren't carried in claude's stream-json
  // shape (only the inline base64), so fall back to a placeholder.
  return { kind: 'document', mediaType: block.source.media_type, data: block.source.data, name: 'attachment' }
}

function extractToolResultText(block: ToolResultBlock): string {
  if (typeof block.content === 'string') return block.content
  return block.content
    .map((b: ContentBlock | UserContentBlock) => (b.type === 'text' ? b.text : ''))
    .filter(Boolean)
    .join('\n')
}

function buildContentBlocks(text: string, attachments: readonly SendAttachment[]): UserContentBlock[] {
  const blocks: UserContentBlock[] = []
  // Text-file attachments are inlined as fenced code so the model sees
  // them as part of the prompt; binary attachments become real
  // image/document blocks.
  let prelude = ''
  for (const att of attachments) {
    if (att.kind === 'text') {
      const fence = '```'
      const lang = extname(att.name).slice(1).toLowerCase()
      prelude += `${fence}${lang}${att.name ? ` ${att.name}` : ''}\n${att.text}\n${fence}\n\n`
    }
  }
  const fullText = prelude + text
  if (fullText) blocks.push({ type: 'text', text: fullText })
  for (const att of attachments) {
    if (att.kind === 'image') {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: att.mediaType, data: att.data } })
    } else if (att.kind === 'document') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: att.mediaType, data: att.data } })
    }
  }
  return blocks
}
