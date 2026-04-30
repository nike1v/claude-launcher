// Provider abstraction. IProvider captures lifecycle: what binary, what
// argv, how to format a user message / control command for stdin, what
// env vars to scrub. Wire-format translation (provider stdout →
// NormalizedEvent) lives in IProviderAdapter, created per-session via
// IProvider.createAdapter() so each session has its own translator
// state (line buffer, current turnId, tool_use ↔ item.id pairings).
//
// Resolved at runtime by ProviderKind via the registry. The registry's
// default kind is 'claude' (DEFAULT_PROVIDER_KIND in shared/events).

import type { HostType, SendAttachment } from '../../shared/types'
import type { ApprovalDecision, NormalizedEvent, ProviderKind } from '../../shared/events'

// ── Capabilities ─────────────────────────────────────────────────────────

// Declarative per-provider feature flags. The renderer mounts UI surfaces
// (session-id input, permission prompt, usage modal, model picker)
// conditionally on these.

export interface ProviderCapabilities {
  // 'by-id'      — provider takes a session id and resumes that one
  //                (claude --resume, codex resume by conversation_id).
  // 'last-only'  — provider can resume but only "the last session"
  //                (opencode --continue, aider --continue).
  // 'none'       — every spawn is a fresh session (gemini today).
  readonly resume: 'by-id' | 'last-only' | 'none'

  // 'interactive' — provider emits request.opened events of *_approval
  //                 type and waits for our reply.
  // 'none'        — provider never asks; we never need to render a prompt.
  readonly permissions: 'interactive' | 'none'

  // 'available' — provider exposes a usage/billing surface we can read
  //               (claude /usage, codex rate-limit events).
  // 'none'      — no usage surface.
  readonly usage: 'available' | 'none'

  // 'in-session'  — model can be swapped on an active session.
  // 'unsupported' — changing model requires a fresh spawn.
  readonly sessionModelSwitch: 'in-session' | 'unsupported'

  // 'jsonl'    — newline-delimited JSON transcripts on disk we can replay.
  // 'markdown' — markdown chat history (aider).
  // 'none'     — provider doesn't persist transcripts (codex app-server).
  readonly transcripts: 'jsonl' | 'markdown' | 'none'
}

// ── Spawn / control inputs ───────────────────────────────────────────────

export interface SpawnOpts {
  cwd: string
  model?: string
  // Resume reference. Provider interprets the string per its capabilities;
  // when capabilities.resume === 'none' the provider ignores it.
  resumeRef?: string
  // Provider-specific extras can ride along — each provider knows what to
  // do with them, others ignore. Keeps SpawnOpts stable when a provider
  // grows a new flag (codex sandbox mode, claude permission policy, etc.).
  extra?: Readonly<Record<string, unknown>>
}

export type ControlCommand =
  | { kind: 'interrupt' }
  | { kind: 'approval'; requestId: string; decision: ApprovalDecision }
  | { kind: 'user-input-response'; requestId: string; answers: Readonly<Record<string, unknown>> }

// Env-var scrub patterns. Discriminated to avoid a stringly-typed
// trailing-`*` convention and to keep the matcher in shared.ts simple.
export type EnvScrubPattern = { exact: string } | { prefix: string }

// ── IProvider ────────────────────────────────────────────────────────────

export interface IProvider {
  readonly kind: ProviderKind
  readonly label: string
  readonly capabilities: ProviderCapabilities

  // Build the inner argv for `transport.spawn`. The transport handles
  // host wrapping (ssh foo bar — bash -lc, wsl.exe -d distro --, …);
  // the provider just builds the inner argv for its own binary.
  buildSpawnArgs(opts: SpawnOpts): { bin: string; args: readonly string[] }

  // Format a user-typed message for stdin. Returns the raw string the
  // session-manager writes. Different providers use different framings:
  // claude wants stream-json `{type:'user', message:{...}}`, codex's
  // app-server wants a JSON-RPC envelope, opencode CLI wants plain text.
  formatUserMessage(text: string, attachments: readonly SendAttachment[]): string

  // Translate a high-level intent into the stdin command, or null when
  // the provider has no in-band channel for it (in which case
  // session-manager falls back to SIGINT for interrupt, etc.).
  formatControl(cmd: ControlCommand): string | null

  // Env vars to scrub from the inherited environment before spawn —
  // typically provider-specific OAuth tokens that must not reach a
  // remote child.
  envScrubList(host: HostType): readonly EnvScrubPattern[]

  // Factory for the wire-format translator. Each session gets its own
  // adapter so the translator's internal state (line buffer, current
  // turnId, tool_use ↔ item.id pairings) doesn't leak across sessions.
  // History-reader also creates an adapter per transcript replay.
  createAdapter(): IProviderAdapter
}

// ── IProviderAdapter ────────────────────────────────────────────────────

export interface IProviderAdapter {
  // Parse a chunk of provider stdout and emit normalized events.
  // Stateful — adapter tracks line buffer, current turnId, item IDs,
  // and any open tool_use ↔ item.id pairings across calls. Always
  // safe to call with a partial chunk; the adapter buffers until a
  // line/event boundary.
  parseChunk(chunk: string): NormalizedEvent[]

  // Read a transcript file (full content) and emit normalized events
  // for backfill. Use a fresh adapter per replay — the call site
  // discards the adapter when it's done. Distinct from parseChunk in
  // that it emits user-message items (a live session's user echoes
  // are dropped because the renderer pushed them locally).
  parseTranscript(content: string): NormalizedEvent[]
}
