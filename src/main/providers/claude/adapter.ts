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
import type {
  AssistantEvent,
  ContentBlock,
  DocumentBlock,
  ImageBlock,
  ResultEvent,
  StreamJsonEvent,
  ToolResultBlock,
  UserContentBlock,
  UserEvent
} from '../../../shared/types'
import type { IProviderAdapter } from '../types'
import type { ItemStatus, NormalizedEvent, UserAttachment } from '../../../shared/events'
import { parseStreamJsonLine } from '../../stream-json-parser'

export class ClaudeAdapter implements IProviderAdapter {
  // Live mode: drop user-message echoes (the renderer already pushed
  // them locally via InputBar). Replay mode (transcripts): emit user
  // messages as items because there's no local push.
  private readonly mode: 'live' | 'replay'

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

  public parseChunk(chunk: string): NormalizedEvent[] {
    this.lineBuffer += chunk
    const lines = this.lineBuffer.split('\n')
    this.lineBuffer = lines.pop() ?? ''
    const out: NormalizedEvent[] = []
    for (const line of lines) {
      const event = parseStreamJsonLine(line)
      if (event) this.translate(event, out)
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
      if (event) replayAdapter.translate(event, out)
    }
    return out
  }

  // ── Translation ────────────────────────────────────────────────────────

  private translate(event: StreamJsonEvent, out: NormalizedEvent[]): void {
    if (event.type === 'system' && event.subtype === 'init') {
      out.push({
        kind: 'session.started',
        sessionRef: event.session_id,
        model: event.model,
        cwd: event.cwd
      })
      out.push({ kind: 'session.stateChanged', state: 'ready' })
      return
    }

    if (event.type === 'assistant') {
      this.translateAssistant(event, out)
      return
    }

    if (event.type === 'user') {
      this.translateUser(event, out)
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
    out.push({ kind: 'turn.started', turnId, model })
    return turnId
  }

  private translateAssistant(event: AssistantEvent, out: NormalizedEvent[]): void {
    const turnId = this.ensureTurn(out, event.message.model)

    // Per-call usage snapshot. StatusBar's context-fill meter reads the
    // most recent tokenUsage.updated to compute "used" tokens.
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

    for (const block of event.message.content) {
      if (block.type === 'text') {
        if (!block.text.trim()) continue
        const itemId = `text-${randomUUID()}`
        out.push({ kind: 'item.started', itemId, turnId, itemType: 'assistant_message' })
        out.push({ kind: 'content.delta', itemId, streamKind: 'assistant_text', text: block.text })
        out.push({ kind: 'item.completed', itemId, status: 'completed' })
        continue
      }
      if (block.type === 'thinking') {
        const itemId = `think-${randomUUID()}`
        out.push({ kind: 'item.started', itemId, turnId, itemType: 'reasoning' })
        out.push({ kind: 'content.delta', itemId, streamKind: 'reasoning_text', text: block.thinking })
        out.push({ kind: 'item.completed', itemId, status: 'completed' })
        continue
      }
      if (block.type === 'tool_use') {
        // Use claude's tool_use id directly — it's already unique per
        // call and we need it to pair with the matching tool_result
        // that arrives in a later user event.
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
        // tool_use items don't complete here — they wait for the
        // matching tool_result in a user event. If the session ends
        // first (process exit / interrupt) the open item just stays
        // open in the renderer; that matches v0.4 behaviour.
        continue
      }
    }
  }

  private translateUser(event: UserEvent, out: NormalizedEvent[]): void {
    const content = event.message.content

    if (typeof content === 'string') {
      // Live: the renderer already pushed a local user_message item via
      // InputBar — drop the wire echo.
      // Replay: this is the user's prompt from the transcript.
      if (this.mode === 'replay' && content.trim()) {
        const turnId = this.ensureTurn(out)
        const itemId = `user-${randomUUID()}`
        out.push({ kind: 'item.started', itemId, turnId, itemType: 'user_message', text: content })
        out.push({ kind: 'item.completed', itemId, status: 'completed' })
      }
      return
    }

    // Array content. Sort blocks into tool_results vs prompt blocks.
    const toolResults: ToolResultBlock[] = []
    const promptText: string[] = []
    const promptAttachments: UserAttachment[] = []
    let hasInputMarker = false

    for (const block of content) {
      if (block.type === 'tool_result') {
        if (block.tool_use_id === '__input__') {
          // Sentinel marker the local InputBar adds — never appears on
          // the wire. Defensive in case a transcript ever contains it.
          hasInputMarker = true
          continue
        }
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
    // already pushed locally.
    const text = promptText.join('\n').trim()
    const hasPrompt = text.length > 0 || promptAttachments.length > 0
    if (hasPrompt && this.mode === 'replay' && !hasInputMarker) {
      const turnId = this.ensureTurn(out)
      const itemId = `user-${randomUUID()}`
      out.push({
        kind: 'item.started',
        itemId,
        turnId,
        itemType: 'user_message',
        text,
        attachments: promptAttachments.length ? promptAttachments : undefined
      })
      out.push({ kind: 'item.completed', itemId, status: 'completed' })
    }
  }

  private translateResult(event: ResultEvent, out: NormalizedEvent[]): void {
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

    if (this.openTurnId) {
      const turnId = this.openTurnId
      this.openTurnId = null
      out.push({
        kind: 'turn.completed',
        turnId,
        status: event.is_error ? 'failed' : 'completed'
      })
    }
  }
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
