// ClaudeAdapter — translates claude's `--output-format stream-json` wire
// format into NormalizedEvent. Pair with ClaudeProvider in the registry.
//
// PR 2 ships placeholder implementations: real translation lands in PR 3
// alongside the renderer rewrite. Doing the translation here without a
// renderer to validate against would lock in a shape that PR 3 might
// need to revise — better to design the two together.
//
// Until PR 3, session-manager + history-reader keep calling
// parseStreamJsonLine directly for the live IPC + transcript backfill.
// This adapter is registered but not on the live data path.

import type { NormalizedEvent } from '../../../shared/events'
import type { IProviderAdapter } from '../types'

export class ClaudeAdapter implements IProviderAdapter {
  public readonly kind = 'claude' as const

  public parseChunk(_chunk: string): NormalizedEvent[] {
    return []
  }

  public parseTranscript(_content: string): NormalizedEvent[] {
    return []
  }
}
