// Provider abstraction. Two interfaces, one stateless, one per-session:
//
// - IProvider: lifecycle + identity. What binary, what argv, what env
//   vars to scrub, what capabilities, the per-session-adapter factory.
//   Stateless — same instance serves every session of that kind.
//
// - IProviderAdapter: bidirectional wire translator created per session.
//   Owns the protocol — translates stdout chunks into NormalizedEvents
//   AND formats stdin writes (user messages, control commands,
//   bootstrap handshakes). For stateless protocols (claude stream-json)
//   this is just a parser + a couple of pure formatters. For stateful
//   protocols (codex JSON-RPC) it's a small client state machine
//   tracking thread / turn / request ids and queueing follow-up writes
//   triggered by responses.
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
  //                (claude --resume, codex thread/resume).
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
  // 'none'     — provider doesn't persist transcripts.
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

  // Binary name + version-banner regex used by transport.probe. The
  // regex catches "wrong binary on PATH" cases (a stub `claude` shell
  // function, a wrapper that exits 0 with no output, etc.) before we
  // hand the child to the rest of the pipeline.
  probeOptions(): { bin: string; versionLine: RegExp }

  // Env vars to scrub from the inherited environment before spawn —
  // typically provider-specific OAuth tokens that must not reach a
  // remote child.
  envScrubList(host: HostType): readonly EnvScrubPattern[]

  // Factory for the wire translator. Each session gets its own adapter
  // so its internal state (line buffer, JSON-RPC ids, threadId,
  // tool_use ↔ item.id pairings) doesn't leak across sessions. The
  // history-reader also creates one per transcript replay.
  createAdapter(): IProviderAdapter
}

// ── IProviderAdapter ────────────────────────────────────────────────────

export interface IProviderAdapter {
  // Bytes to write to the child's stdin immediately after spawn.
  // Stateless protocols (claude) return ''. Stateful protocols (codex)
  // return their initial handshake (e.g. JSON-RPC `initialize` request).
  startupBytes(opts: SpawnOpts): string

  // Parse a chunk of provider stdout and emit normalized events.
  // Stateful — adapter tracks the line buffer, JSON-RPC pending
  // requests, current threadId / turnId, tool_use ↔ item.id pairings,
  // etc. across calls. Safe to call with a partial chunk.
  parseChunk(chunk: string): NormalizedEvent[]

  // Bytes the adapter wants to write asynchronously, drained by
  // session-manager after every parseChunk / startupBytes /
  // formatUserMessage / formatControl call. Used by JSON-RPC adapters
  // that need to follow up on a server response (e.g. send `initialized`
  // + `thread/start` after the `initialize` result arrives). Returns ''
  // when nothing is queued.
  drainPendingWrites(): string

  // Read a transcript file (full content) and emit normalized events
  // for backfill. Use a fresh adapter per replay — the call site
  // discards the adapter when it's done. Distinct from parseChunk in
  // that it emits user-message items (a live session's user echoes
  // are dropped because the renderer pushed them locally).
  parseTranscript(content: string): NormalizedEvent[]

  // Format a user-typed message for stdin. Returns the raw string the
  // session-manager writes. Stateful providers consult their internal
  // session state (threadId, JSON-RPC id counter) when constructing
  // the message.
  formatUserMessage(text: string, attachments: readonly SendAttachment[]): string

  // Translate a high-level control intent into stdin bytes, or null
  // when the provider has no in-band channel for it (session-manager
  // then falls back to SIGINT for interrupt). Stateful providers may
  // need the current threadId / turnId / pending request id.
  formatControl(cmd: ControlCommand): string | null
}
