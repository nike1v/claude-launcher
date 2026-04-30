// One-shot startup wiring — call from main `app.whenReady()` before any
// IPC handler runs. Idempotent (the registry overwrites prior entries
// for the same kind).

import { register, hasProvider } from './registry'
import { ClaudeProvider } from './claude/provider'
import { ClaudeAdapter } from './claude/adapter'

export function initProviders(): void {
  if (!hasProvider('claude')) {
    register(new ClaudeProvider(), new ClaudeAdapter())
  }
}
