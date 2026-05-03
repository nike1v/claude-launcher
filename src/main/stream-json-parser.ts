import type { StreamJsonEvent } from '../shared/types'

// Parser for one line of claude's --output-format=stream-json output.
//
// We only forward events the renderer knows how to render; everything else
// is dropped. The parser is intentionally strict per branch — we validate
// the *required* fields for each event shape before casting, so a malformed
// init (missing session_id / model) doesn't reach StatusBar / listeners and
// crash the renderer when it dereferences those fields.
//
// Returning null vs throwing keeps the caller (history-reader, session-
// manager) able to filter cleanly without try/catch noise around every
// line.
export function parseStreamJsonLine(line: string): StreamJsonEvent | null {
  if (!line.trim()) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null
  const type = parsed.type
  if (typeof type !== 'string') return null

  switch (type) {
    case 'system': {
      if (parsed.subtype === 'init') {
        if (typeof parsed.session_id !== 'string') return null
        if (typeof parsed.model !== 'string') return null
        if (typeof parsed.cwd !== 'string') return null
        return parsed as unknown as StreamJsonEvent
      }
      if (parsed.subtype === 'status') {
        // status is 'compacting' (entry) or null (exit); anything else
        // is a future variant we don't recognise — drop it.
        if (parsed.status !== 'compacting' && parsed.status !== null) return null
        return parsed as unknown as StreamJsonEvent
      }
      if (parsed.subtype === 'compact_boundary') {
        // compact_metadata is the only field we read from this event —
        // the rest (session_id, uuid) are wire bookkeeping. Require it
        // to be a record so the adapter can safely look up post_tokens.
        if (!isRecord(parsed.compact_metadata)) return null
        return parsed as unknown as StreamJsonEvent
      }
      return null
    }
    case 'assistant': {
      if (!isRecord(parsed.message)) return null
      if (!Array.isArray((parsed.message as Record<string, unknown>).content)) return null
      return parsed as unknown as StreamJsonEvent
    }
    case 'user': {
      if (!isRecord(parsed.message)) return null
      const msg = parsed.message as Record<string, unknown>
      // user content is `string | UserContentBlock[]` — both are valid.
      if (typeof msg.content !== 'string' && !Array.isArray(msg.content)) return null
      return parsed as unknown as StreamJsonEvent
    }
    case 'result': {
      if (typeof parsed.subtype !== 'string') return null
      if (typeof parsed.session_id !== 'string') return null
      if (typeof parsed.is_error !== 'boolean') return null
      return parsed as unknown as StreamJsonEvent
    }
    default:
      return null
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
