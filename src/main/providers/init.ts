// One-shot startup wiring — call from main `app.whenReady()` before any
// IPC handler runs. Idempotent: register() overwrites the prior entry
// for the same kind, so calling this twice is harmless.

import { register } from './registry'
import { ClaudeProvider } from './claude/provider'
import { CodexProvider } from './codex/provider'
import { CursorProvider } from './cursor/provider'
import { OpencodeProvider } from './opencode/provider'

export function initProviders(): void {
  register(new ClaudeProvider())
  register(new CodexProvider())
  register(new CursorProvider())
  register(new OpencodeProvider())
}
