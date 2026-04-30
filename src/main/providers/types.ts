// Provider abstraction. Two interfaces, one per concern:
//
// - IProvider:      lifecycle. What binary, what argv, how to format a
//                   user message / control command for stdin, what env
//                   vars to scrub, where transcripts live.
//
// - IProviderAdapter: wire-format translation. Provider stdout (chunk or
//                     transcript file) → NormalizedEvent[].
//
// Splitting these lets us swap parsers without touching spawn logic and
// vice versa. PR 1 just defines the shapes; PR 2 fills them in for claude.
//
// Both are resolved at runtime by ProviderKind via the registry. The
// registry default is 'claude' — projects without `providerKind` set
// keep working as they did in v0.4.

import type { HostType, SendAttachment } from '../../shared/types'
import type { ApprovalDecision, NormalizedEvent, ProviderKind } from '../../shared/events'

// ── Capabilities ─────────────────────────────────────────────────────────

// Declarative per-provider feature flags. The renderer mounts UI surfaces
// (session-id input, permission prompt, usage modal, model picker)
// conditionally on these — cleaner than the "method returns null when not
// applicable" pattern, and easier to lint.

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
  // do with them, others ignore. Keeping this open-ended avoids churning
  // SpawnOpts every time a provider grows a new flag (codex sandbox
  // mode, claude permission policy, etc.).
  extra?: Readonly<Record<string, unknown>>
}

export type ControlCommand =
  | { kind: 'interrupt' }
  | { kind: 'approval'; requestId: string; decision: ApprovalDecision }
  | { kind: 'user-input-response'; requestId: string; answers: Readonly<Record<string, unknown>> }

export type ProbeResult = { ok: true; version: string } | { ok: false; reason: string }

// ── IProvider ────────────────────────────────────────────────────────────

export interface IProvider {
  readonly kind: ProviderKind
  readonly label: string
  readonly capabilities: ProviderCapabilities

  // Pre-flight check — version probe over the env's transport.
  probeBinary(host: HostType): Promise<ProbeResult>

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

  // Where the provider stores on-disk transcripts on the env, if anywhere.
  // null means `capabilities.transcripts === 'none'` for this host.
  transcriptDir(host: HostType, projectPath: string): string | null

  // Env vars to scrub from the inherited environment before spawn. Today
  // claude needs CLAUDE_CODE_OAUTH_TOKEN stripped on remotes so the
  // remote uses its own creds, not the launcher's local creds. Generalises
  // per-provider.
  envScrubList(host: HostType): readonly string[]
}

// ── IProviderAdapter ─────────────────────────────────────────────────────

export interface IProviderAdapter {
  readonly kind: ProviderKind

  // Parse one buffered chunk of provider stdout into zero-or-more
  // normalized events. Most providers are newline-delimited and emit
  // 0 or 1 events per line; some (JSON-RPC bidirectional) need to
  // distinguish notifications from request/responses, hence the array.
  // Adapters keep their own internal line-buffer state if their wire
  // format isn't strictly newline-delimited.
  parseChunk(chunk: string): NormalizedEvent[]

  // Read a transcript file off disk and emit normalized events for
  // backfill. Symmetrical with parseChunk so live + backfill render
  // through the same code path. For providers with
  // `capabilities.transcripts === 'none'` this returns [].
  parseTranscript(content: string): NormalizedEvent[]
}
