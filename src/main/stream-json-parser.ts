import type { StreamJsonEvent } from '../shared/types'

export function parseStreamJsonLine(line: string): StreamJsonEvent | null {
  if (!line.trim()) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) {
    return null
  }

  const event = parsed as Record<string, unknown>

  switch (event.type) {
    case 'system':
      if (event.subtype === 'init') return parsed as StreamJsonEvent
      return null
    case 'assistant':
      return parsed as StreamJsonEvent
    case 'user':
      return parsed as StreamJsonEvent
    case 'result':
      return parsed as StreamJsonEvent
    default:
      return null
  }
}
