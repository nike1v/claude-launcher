# Adding new LLM providers

This doc sketches what it takes to add a second provider (Codex, opencode,
Cursor, Aider, Gemini, …) alongside the current `claude` CLI. It's the
deliverable that gates real "let's add provider X" work — so we go in
with the right scope already mapped, instead of finding the hard parts
halfway through implementation.

## Constraint: every provider is a CLI we spawn

Before the design — the universal pattern is **spawn-the-binary over a
transport**. No embedded SDKs, no in-process agent runtimes, no hybrid
"local uses SDK / remote uses CLI" splits. Reasons:

- WSL / SSH environments can't use an embedded SDK. The SDK's tools run
  in whichever process holds it, and that process is our Electron main
  on the user's local machine — not in the remote distro / host. To
  reach a remote, you have to spawn something there, which is what
  the CLI model already does.
- Splitting the architecture into "in-process for local, child process
  for remote" doubles the surface area: two parsers, two control
  protocols, two auth flows, two ways every feature has to be wired.
- The user's existing claude setup (credentials, MCP servers, hooks,
  plugins) lives next to wherever claude is installed. Spawning the
  user's installed binary inherits all of that for free; an embedded
  SDK would need us to mirror or re-parse those configs ourselves.

So: every provider integration is a spawned binary speaking some wire
format over stdio, on top of the existing transport layer. The variation
between providers is in **what binary**, **what argv**, **what wire
format on stdout**, **what control commands on stdin**, and **what
on-disk transcripts**.

The launcher today is **claude-shaped end-to-end**: every transport spawns
the `claude` binary, every parser expects claude's `--output-format
stream-json`, every UI surface assumes claude's permission-prompt protocol
and resume conventions. Generalising means picking apart which of those
assumptions are load-bearing for the user experience and which are
incidental implementation choices.

This is a planning doc, not a checklist. Use it when the question "what
would it take to add Codex?" actually comes up.

---

## Prior art: t3code

[`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) is the closest
existing reference — a desktop GUI fronting four providers (`codex`,
`claudeAgent`, `opencode`, `cursor`). Worth understanding what they do
and where their choices diverge from ours.

**What t3code does that's relevant:**

- **Provider/Adapter split.** Per-provider code is split into a
  *Provider* (lifecycle: start session, send turn, interrupt, stop,
  capabilities) and an *Adapter* (translates the provider's native
  events into a normalized runtime event stream). One responsibility
  each. We adopt this split.
- **Rich normalized event taxonomy.** ~45 event variants covering
  `session.*`, `thread.*`, `turn.*`, `item.*`, `request.*`,
  `content.delta`, `tool.*`, `auth.*`, `model.*`, etc. The "item" and
  "request" concepts (sub-units inside a turn, separate from approval
  requests) are useful — claude's stream-json doesn't have them
  explicitly but they fall out naturally if you squint at tool blocks.
- **Capabilities object per adapter.** Declarative feature flags like
  `sessionModelSwitch: 'in-session' | 'unsupported'`. Replaces the
  "return null when not applicable" pattern.
- **Four-state approval decisions.** `accept | acceptForSession |
  decline | cancel`. Claude already has the "always allow" pattern;
  exposing it via the API is just wiring.
- **ProviderKind as a tagged enum.** `'codex' | 'claudeAgent' |
  'cursor' | 'opencode'`. Per-provider model selections are a
  discriminated union.

**Where t3code goes the other way (and why we don't):**

t3code talks to its providers via three different mechanisms:

| Provider | t3code's mechanism |
|---|---|
| `claudeAgent` | `@anthropic-ai/claude-agent-sdk` — in-process SDK |
| `opencode` | `@opencode-ai/sdk/v2` — in-process SDK |
| `codex` | Spawn `codex app-server` (stdio JSON-RPC) |
| `cursor` | Spawn `cursor agent acp` (stdio, Zed's Agent Client Protocol) |

They are not a "spawn-the-CLI" shop — they use SDKs where they exist and
spawn JSON-RPC stdio servers where they don't. This works for them
because they only run on the local machine. We picked the opposite,
intentionally: every provider is a spawned binary, no SDK option, because
WSL / SSH require it. Their SDK code paths don't transfer.

The interesting half is that **even for spawn-based providers, t3code's
choice (codex `app-server`, cursor `agent acp`) confirms the universal
pattern is fine.** Modern AI CLIs are increasingly shipping a stdio
JSON-RPC subcommand for exactly this kind of host-to-agent integration.
Our shape — spawn binary, exchange newline-delimited JSON over stdio —
maps cleanly onto every one we've looked at.

**ACP (Agent Client Protocol)** deserves a callout: it's Zed's emerging
standard for stdio JSON-RPC between an editor / host and an AI agent.
Cursor's `agent acp` mode speaks it; Gemini and others may follow. If
ACP gets traction we'd collapse multiple providers into one
`AcpProvider` adapter, configured by the binary path + ACP extensions.
Not a blocker for the v1 design.

**Effect-TS** is another t3code dependency we don't take: their adapter
shapes are `Effect.Effect<...>` and `Stream.Stream<...>` typed. We
hand-roll plain promises and event emitters; importing Effect just to
mimic the shape would be ~200KB of dependency for no behavioral win.

---

## What's already an abstraction (and what isn't)

The codebase has **one** real provider abstraction: `ITransport`. That
covers _where_ a process runs (local / WSL / SSH) — not _what_ runs in it.

`src/main/transports/types.ts`:

```ts
export interface ITransport {
  spawn(options: SpawnOptions): ChildProcess
  probe(host: HostType): Promise<ProbeResult>
}
```

Every transport (`local.ts`, `wsl.ts`, `ssh.ts`) hardcodes:

- The binary name (`claude`).
- The argv (`buildClaudeArgs()` from `transports/shared.ts` — the
  `--output-format stream-json --input-format stream-json --verbose
  --permission-prompt-tool stdio` block, plus `--model` / `--resume`).
- The probe payload (`probeScript()` calls `claude --version`).

And the consumers of that ChildProcess assume claude semantics:

- `session-manager.ts` parses stdout as claude's stream-json line format.
- `session-manager.interruptSession` writes a claude-specific
  `control_request` / `interrupt` JSON line.
- `ProjectItem.handleClick` passes `--resume <id>` to startSession on
  the assumption that's how resume works.
- `history-reader.ts` reads `~/.claude/projects/<slug>/<id>.jsonl`
  files claude itself writes — that's claude's transcript format and
  on-disk path convention.
- `usage-probe.ts` PTY-types `/usage` and screen-scrapes the panel —
  pure claude-CLI behaviour.

So the work is in three layers:

1. **An `IProvider` interface** capturing lifecycle (spawn args, send
   user message, interrupt, stop, version probe) and declarative
   capabilities (does this provider resume? show usage? have permission
   prompts? support model switch in-session?).
2. **An `IProviderAdapter` interface** capturing wire-format
   translation (provider's stdout chunk → `NormalizedEvent`) and
   transcript backfill.
3. **Per-feature decisions** for UI surfaces that don't translate
   universally (no `/usage` for opencode, no `--resume` for Gemini, etc.).

`ITransport` stays where it is — it's provider-agnostic.

---

## Provider/Adapter split

Two interfaces, both provider-specific. Lifecycle and event translation
are separate concerns; conflating them works for one provider and breaks
for the second.

```ts
// src/main/providers/types.ts (proposed)

export type ProviderKind = 'claude' | 'codex' | 'opencode' | 'cursor'

export interface ProviderCapabilities {
  // Whether this provider has a resume-by-id concept. Drives whether
  // we show the session-id field in project settings.
  resume: 'by-id' | 'last-only' | 'none'
  // Whether the provider emits permission-request events. Drives
  // whether the renderer mounts PermissionPrompt at all.
  permissions: 'interactive' | 'none'
  // Whether the provider exposes a usage / billing surface we can read.
  usage: 'available' | 'none'
  // Whether changing the model on an active session is supported, vs.
  // requires a fresh spawn.
  sessionModelSwitch: 'in-session' | 'unsupported'
  // Whether the provider writes its own transcripts to disk.
  transcripts: 'jsonl' | 'markdown' | 'none'
}

export interface IProvider {
  readonly kind: ProviderKind
  readonly label: string
  readonly capabilities: ProviderCapabilities

  // Pre-flight check — `<binary> --version`-equivalent.
  probeBinary(host: HostType): Promise<ProbeResult>

  // Build the argv for `transport.spawn`. Transport handles host
  // wrapping (ssh foo bar — bash -lc, wsl.exe -d distro --, …); the
  // provider just builds the inner argv for its own binary.
  buildSpawnArgs(opts: SpawnOpts): { bin: string; args: string[] }

  // Format a user-typed message for stdin. Claude takes
  // `{type:'user', message:{role:'user', content: string|blocks}}` JSON
  // lines; codex's app-server takes a different JSON-RPC envelope; etc.
  formatUserMessage(text: string, attachments: Attachment[]): string

  // Translate a high-level intent into a stdin command, or null when
  // the provider has no in-band channel for it (in which case session-
  // manager falls back to SIGINT for interrupt, etc.).
  formatControl(cmd: ControlCommand): string | null

  // Where the provider stores its on-disk transcripts on the env, if
  // anywhere. null = no transcripts.
  transcriptDir(host: HostType, projectPath: string): string | null

  // Env vars to scrub from the inherited environment before spawn.
  // Today claude needs CLAUDE_CODE_OAUTH_TOKEN stripped on remotes;
  // codex would need OPENAI_API_KEY-related vars depending on auth
  // strategy; etc.
  envScrubList(host: HostType): readonly string[]
}

export interface IProviderAdapter {
  readonly kind: ProviderKind

  // Parse one buffered chunk of provider stdout into zero-or-more
  // normalized events. Most providers are newline-delimited and emit
  // 0 or 1 events per line; some (JSON-RPC bidirectional) need to
  // distinguish notifications from request/responses, hence array.
  parseChunk(chunk: string): NormalizedEvent[]

  // Read a transcript file off disk and emit normalized events for
  // backfill. Symmetrical with parseChunk so live + backfill render
  // through the same code path.
  parseTranscript(content: string): NormalizedEvent[]
}

export interface SpawnOpts {
  cwd: string
  model?: string
  resumeRef?: string  // null when provider has no resume concept
  // Provider-specific extras can ride along — each provider knows what
  // to do with them, others ignore.
  extra?: Record<string, unknown>
}

export type ApprovalDecision =
  | 'accept'
  | 'acceptForSession'  // remember this answer for the session
  | 'decline'
  | 'cancel'

export type ControlCommand =
  | { kind: 'interrupt' }
  | { kind: 'approval'; requestId: string; decision: ApprovalDecision }
  | { kind: 'user-input-response'; requestId: string; answers: Record<string, unknown> }
```

The current claude implementation becomes `ClaudeProvider implements
IProvider` + `ClaudeAdapter implements IProviderAdapter` — pulls argv
builder, transcript path, env-scrub list into the provider; pulls
stream-json parser, transcript reader into the adapter. ~150 lines moved
across two files.

`session-manager.ts` resolves both via `getProvider(kind)` /
`getAdapter(kind)` from a registry, then takes `(transport, provider,
adapter, ...)`. Renderer events flow through `adapter.parseChunk` into a
normalized shape.

---

## NormalizedEvent

Today the IPC channel `'session:event'` carries claude's `StreamJsonEvent`
union — `system`, `assistant`, `user`, `result` types with claude-specific
fields. The renderer's `MessageList` component pattern-matches on this
shape directly.

A multi-provider world needs a richer-than-claude, provider-agnostic
event shape. Sized between our previous 7-variant draft and t3code's
45-variant taxonomy:

```ts
// src/shared/events.ts (proposed)

export type NormalizedEvent =
  // Session lifecycle
  | { kind: 'session.started'; sessionRef: string; model?: string }
  | { kind: 'session.stateChanged'; state: SessionState; reason?: string }
  | { kind: 'session.exited'; reason?: string; exitKind: 'graceful' | 'error' }

  // Turn lifecycle (one user message → one assistant reply)
  | { kind: 'turn.started'; turnId: string; model?: string }
  | { kind: 'turn.completed'; turnId: string; usage?: TokenUsage; status: 'completed' | 'failed' | 'interrupted' }

  // Items inside a turn — assistant_message, reasoning, tool_use, etc.
  | { kind: 'item.started'; itemId: string; turnId: string; itemType: ItemType }
  | { kind: 'item.completed'; itemId: string; status: 'completed' | 'failed' | 'declined' }

  // Streaming content — flows into a previously-started item
  | { kind: 'content.delta'; itemId: string; streamKind: ContentStreamKind; text: string }

  // Approval / permission flow
  | { kind: 'request.opened'; requestId: string; itemId?: string; requestType: RequestType; payload: unknown }
  | { kind: 'request.resolved'; requestId: string; decision: ApprovalDecision }

  // Structured user input (e.g. multiple-choice in MCP tools)
  | { kind: 'userInput.requested'; requestId: string; questions: UserInputQuestion[] }
  | { kind: 'userInput.resolved'; requestId: string; answers: Record<string, unknown> }

  // Streaming usage updates
  | { kind: 'tokenUsage.updated'; usage: TokenUsage }

  // Errors / warnings — surfaced to the user as banners, not turn output
  | { kind: 'warning'; message: string; detail?: unknown }
  | { kind: 'error'; message: string; class: ErrorClass; detail?: unknown }

export type SessionState = 'starting' | 'ready' | 'running' | 'waiting' | 'stopped' | 'error'

export type ItemType =
  | 'user_message'
  | 'assistant_message'
  | 'reasoning'
  | 'plan'
  | 'tool_use'
  | 'file_change'
  | 'command_execution'
  | 'web_search'
  | 'unknown'

export type ContentStreamKind = 'assistant_text' | 'reasoning_text' | 'plan_text' | 'command_output' | 'unknown'

export type RequestType =
  | 'tool_approval'      // claude's permission prompt
  | 'command_approval'   // codex sandboxed exec wants permission
  | 'file_change_approval'
  | 'unknown'

export type ErrorClass = 'provider_error' | 'transport_error' | 'permission_error' | 'validation_error' | 'unknown'

export interface TokenUsage {
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  contextWindow?: number
}

export interface UserInputQuestion {
  id: string
  prompt: string
  kind: 'text' | 'choice'
  choices?: string[]
}
```

Each provider's `parseChunk` maps its native wire format to this. The
on-disk transcripts stay in claude's native shape — that's how claude
wrote them, we don't get to retroactively normalise the historical
record. `ClaudeAdapter.parseTranscript` translates on read.

This is the **single highest-friction part of the refactor**. The current
code passes `StreamJsonEvent` through the IPC and into the React tree
unchanged. Migrating means touching every component that renders messages
(`AssistantMessage`, `UserMessage`, `ToolUse`, `Thinking`,
`PermissionPrompt`, `MessageList`'s `groupMessages` and `classify`).

The "items + content deltas" pattern matches how all four providers we've
surveyed actually structure their output. Claude's `assistant` message
with `content: [{type:'text', text}]` blocks → `item.started` (assistant_message)
+ `content.delta` (assistant_text). Codex's app-server notifications follow
the same shape natively. Cursor's ACP notifications too. Mapping is
mechanical for all four.

---

## Per-feature decisions

These are the choices that come up when you actually start mapping a
specific provider in. Listed as a checklist so we know what the questions
are before someone asks "but how does Codex do X?".

### Resume / session continuity

| Provider | Resume mechanism | Capabilities |
|---|---|---|
| claude   | `--resume <session-id>` flag, on-disk JSONL transcript | `resume: 'by-id'` |
| codex    | `app-server` JSON-RPC `resume` method, persists by `conversation_id` | `resume: 'by-id'` |
| opencode | Persists session ids via SDK; CLI `--continue` resumes last | `resume: 'last-only'` (CLI mode) |
| cursor   | ACP defines `session/resume` w/ `sessionId` | `resume: 'by-id'` |
| Gemini   | No native resume — fresh session every spawn | `resume: 'none'` |

The `lastClaudeSessionId` field on `Project` becomes provider-agnostic
`lastSessionRef: string | null`. The provider interprets the string
however it wants, or ignores it when `capabilities.resume === 'none'`.

### Transcript backfill

`history-reader.ts.loadSessionEvents` reads
`claude/projects/<slug>/<id>.jsonl` and parses each line through
`parseStreamJsonLine`. For a provider whose transcripts aren't JSONL,
the reader needs `IProviderAdapter.parseTranscript`. For a provider with
no transcripts (`capabilities.transcripts === 'none'`), history is
"whatever the renderer's messages store has in memory".

`provider.transcriptDir(host, path)` + `adapter.parseTranscript(content)`
covers both halves of the read side.

### Permission prompts

Claude announces tool-use intent and waits for `--permission-prompt-tool
stdio` to reply before continuing. Codex has its own approval flow over
`app-server` (`request.opened` events with `requestType:
'command_approval'`). Cursor over ACP has `session/request_permission`.
Gemini and aider have no flow at all — they just do the thing.

The renderer's `PermissionPrompt` component mounts only for adapters
emitting `request.opened` events with `requestType` in the
`*_approval` family. Capabilities flag `permissions: 'interactive' |
'none'` drives the UI affordance globally for the provider.

### Usage / billing

`/usage` is a claude-CLI-specific TUI panel scraped via PTY. Codex's
`app-server` emits `account.rate-limits.updated` events natively —
just wire the adapter to translate them to `tokenUsage.updated`.
Cursor / opencode / Aider mostly have nothing — `capabilities.usage:
'none'` and the modal hides itself.

`provider.fetchUsage(host)` returns `null` for those rows.

### Model picking

`buildClaudeArgs(model, ...)` injects `--model` into the argv. Every
provider has a `--model` flag, but the *valid model strings* differ.
Each provider exposes a `suggestedModels(): readonly string[]` — the
combobox populates from the project's provider, not from a global pool.

`Environment.defaultModel: string` stays generic — interpretation is
per-provider.

### Stop / interrupt

| Provider | Mechanism |
|---|---|
| claude   | `control_request/interrupt` JSON line on stdin |
| codex    | `app-server` `interrupt` JSON-RPC method |
| cursor   | ACP `session/cancel` |
| opencode | SIGINT (no in-band) |
| Gemini   | SIGINT (no in-band) |

`provider.formatControl({kind: 'interrupt'})` returns a stdin string or
null. Null means "session-manager sends SIGINT to the child instead."

### Auth / env scrubbing

Today we silently strip `CLAUDE_CODE_OAUTH_TOKEN` from spawned env so a
remote uses its own creds, not the host's. Generalising:
`provider.envScrubList(host)` returns the list. Per-provider:

| Provider | Scrub from inherited env |
|---|---|
| claude   | `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_*` |
| codex    | `OPENAI_API_KEY`, `OPENAI_*` (when running on a remote with its own creds) |
| cursor   | `CURSOR_*` |
| opencode | none today |

---

## Pieces of the codebase that would change

Concrete files, scoped roughly. **None** of these need to change unless
we actually take this on — this is just the inventory.

| File | Today | Multi-provider |
|---|---|---|
| `src/main/transports/shared.ts` | `buildClaudeArgs` | Becomes `provider.buildSpawnArgs` |
| `src/main/transports/{local,wsl,ssh}.ts` | spawn `claude` | spawn `provider.bin` with `provider.buildSpawnArgs` |
| `src/main/transports/probe.ts` | `runShellProbe` checks for "Claude Code" banner | `provider.probeBinary(host)` returns its own match |
| `src/main/session-manager.ts` | parses claude stream-json | Dispatches chunks through `adapter.parseChunk` to `NormalizedEvent` |
| `src/main/history-reader.ts` | reads claude JSONL transcripts | Dispatches through `provider.transcriptDir` + `adapter.parseTranscript` |
| `src/main/usage-probe.ts` | scrapes claude's `/usage` TUI | `provider.fetchUsage(host)` — null for most |
| `src/main/providers/` (new) | — | `types.ts`, `registry.ts`, `claude/{provider,adapter}.ts` |
| `src/shared/types.ts` | `StreamJsonEvent` union | Plus `NormalizedEvent`, `ProviderKind`, `Capabilities` |
| `src/shared/events.ts` (new) | — | The `NormalizedEvent` union and item / request enums |
| `src/shared/host-utils.ts` `transcriptDirHint` | hardcodes `~/.claude/projects` | Delegates to `provider.transcriptDir` |
| `src/renderer/src/components/Chat/*` | renders claude's event shapes | Renders `NormalizedEvent` |
| `src/renderer/src/components/Sidebar/AddProjectModal.tsx` | session id + transcripts hint | Plus a Provider picker; session-id field shows only when `capabilities.resume === 'by-id'` |
| `src/renderer/src/components/Settings/*` | env probe + usage modal | Both delegate through provider |

`Project` and `Environment` gain `providerKind?: ProviderKind`, defaulting
to `'claude'` for legacy entries via the validators / migration.
`Project.lastClaudeSessionId` renames to `lastSessionRef` after the
renderer is provider-agnostic (PR 3).

---

## Migration order

The 4-PR rollout. Each is shippable on its own; the user-visible feature
only lands at PR 4.

### PR 1 — Types & registry skeleton (no behavior change)

Pure additive. Lays the foundation, no provider wired in yet.

- New `src/main/providers/types.ts` — `IProvider`, `IProviderAdapter`,
  `ProviderCapabilities`, `SpawnOpts`, `ControlCommand`, `ApprovalDecision`.
- New `src/shared/events.ts` — `NormalizedEvent` union plus the
  `SessionState` / `ItemType` / `ContentStreamKind` / `RequestType` /
  `ErrorClass` enums and `TokenUsage` / `UserInputQuestion` shapes.
- New `src/main/providers/registry.ts` — `getProvider(kind)`,
  `getAdapter(kind)`. Hardcoded `'claude'` only entry today.
- `Project.providerKind?: ProviderKind` and
  `Environment.providerKind?: ProviderKind` (both optional, default
  `'claude'`).
- Validators in `validate-persisted.ts` updated to accept the optional
  field.
- Tests for registry lookup + validator additions.

**No renames yet** — `lastClaudeSessionId` / `claudeSessionId` stay as-is.
Renaming before the renderer is provider-agnostic just churns the field
twice.

### PR 2 — `ClaudeProvider` + `ClaudeAdapter` (still the only provider)

Pure refactor. Moves existing claude code behind the new interfaces.

- New `src/main/providers/claude/provider.ts` —
  `class ClaudeProvider implements IProvider`. Pulls in
  `buildClaudeArgs`, transcript dir, env-scrub list, version probe.
- New `src/main/providers/claude/adapter.ts` —
  `class ClaudeAdapter implements IProviderAdapter`. Pulls in
  `parseStreamJsonLine`, transcript JSONL reader.
- `session-manager.ts` takes `(transport, provider, adapter, ...)` —
  resolves both from the registry by
  `project.providerKind ?? 'claude'`.
- Transports drop the `'claude'` literal: `local.ts` / `wsl.ts` /
  `ssh.ts` use `provider.buildSpawnArgs(opts)` for the binary + argv.
- `probe.ts` takes a provider-supplied version-check predicate
  instead of grep'ing for `Claude Code`.
- `history-reader.ts` dispatches through `provider.transcriptDir()` +
  `adapter.parseTranscript()`.
- `usage-probe.ts` becomes `provider.fetchUsage(host)` — returns the
  scraped panel today, null for non-claude providers later.

**Renderer untouched.** `ClaudeAdapter.parseChunk` still emits the
existing `StreamJsonEvent` shape today (re-cast to `NormalizedEvent`
in PR 3), so `MessageList` etc. don't change.

### PR 3 — Renderer consumes `NormalizedEvent`

The high-friction piece.

- `ClaudeAdapter.parseChunk` returns `NormalizedEvent` instead of
  `StreamJsonEvent`.
- `'session:event'` IPC carries `NormalizedEvent`.
- Rewrite `MessageList`, `group-messages.ts`, `messages` store,
  `AssistantMessage`, `UserMessage`, `ToolUse`, `Thinking`,
  `PermissionPrompt` to discriminate on `kind` instead of `type`.
  Use `item.started` + `content.delta` to drive the streaming text
  layout instead of the current "block" model.
- `StreamJsonEvent` becomes purely internal to `ClaudeAdapter`;
  renderer no longer imports it.
- One-shot transcript replay in `history-reader.ts` keeps producing
  `NormalizedEvent` too (so backfill renders identically to live).

After PR 3 ships, the renderer is provider-agnostic. *Now* the field
rename has value:
- `lastClaudeSessionId` → `lastSessionRef` (Project)
- `claudeSessionId` (Session, PersistedTab) → `sessionRef`
- `Environment.defaultModel` stays — already generic.

### PR 4 — First non-claude provider: Codex

Codex CLI's `app-server` mode is the closest fit (stdio JSON-RPC,
designed for exactly this). It's also what t3code uses for codex,
which means there's a known-working reference for the wire format.

- New `src/main/providers/codex/provider.ts` — spawns
  `codex app-server`, sends user messages via the `sendUserTurn`
  JSON-RPC method, formatControl writes `interrupt` JSON-RPC.
- New `src/main/providers/codex/adapter.ts` — translates
  `app-server` notifications (`session.configured`, `agent.message`,
  `agent.command_executed`, `task_started`, etc.) into our
  `NormalizedEvent`.
- Provider picker in `AddProjectModal` — defaults to
  `Environment.providerKind` if set, else claude.
- Tests: parser fixtures from real codex `app-server` traces.
- Capability flags wired: `resume: 'by-id'`, `permissions:
  'interactive'`, `usage: 'available'`, `transcripts: 'none'` (codex
  app-server sessions don't write disk transcripts the way claude
  does).

Once codex is in, opencode and cursor follow the same shape — each is
~1 PR. Cursor over ACP would also surface the shared `effect-acp`-style
helpers we'd factor out at that point.

If `parseChunk` for the new provider can't cleanly produce
`NormalizedEvent`, that's the design defect — and PR 3's shape gets
revised before we add a third.

---

## What's NOT planned here

- **No embedded SDKs / in-process agent runtimes.** See the constraint
  at the top. The Anthropic Agent SDK and `@opencode-ai/sdk` were both
  considered (and t3code uses both); rejected because they don't reach
  WSL / SSH.
- **No support for "claude on Vertex AI" / "claude on Bedrock".** Those
  are claude with a different auth surface, not different providers.
  They'd be Environment config (extra env vars), not a `ProviderKind`
  variant.
- **No "agent" providers** (LangChain agents, AutoGen, custom
  orchestrations). The launcher's mental model is "one chat = one CLI
  process". Multi-agent orchestration is a different product.
- **No browser-only providers** (ChatGPT.com, Claude.ai web). Those live
  outside our process model — we can't spawn a child for them.
- **No multi-provider per project (yet).** PR 4 ships single provider
  per project. Side-by-side "same prompt, two providers" is a separate
  feature on top of the abstraction (multi-tab-per-project + sync'd
  input bar).

If any of those become real requirements, this doc gets revised before we
implement them.

---

## Open questions

These would have to be answered when we actually do this, not now:

1. **Where does `providerKind` live?** Probably both — `Environment`
   carries a default, `Project` overrides if set. Different projects on
   the same WSL distro might use different providers, but most users
   will set it once per environment and forget.
2. **What about projects that run on multiple providers side-by-side?**
   Out of scope for `IProvider` introduction — that's a separate feature
   on top.
3. **Auth.** Each CLI manages its own credentials on the env side —
   claude in `~/.claude/`, codex via `OPENAI_API_KEY` or
   `~/.codex/auth`, cursor via its own login flow, opencode via its
   `~/.opencode/`. We don't manage any of them. The `envScrubList` is
   the only knob we touch.
4. **Streaming framing.** Most CLIs are newline-delimited JSON. Codex's
   `app-server` is JSON-RPC but each message is still one line. Cursor
   over ACP same. If a provider uses Content-Length-style framing, the
   adapter consumes the buffer to whatever boundary the format uses;
   the session-manager just hands it bytes.
5. **ACP.** When more providers adopt Zed's Agent Client Protocol,
   collapse them into one shared `AcpProvider` adapter parameterised by
   binary path + extension namespace. Out of scope for v1; flagged as a
   future simplification.

---

## TL;DR

1. Provider/Adapter split — lifecycle in `IProvider`, wire-format
   translation in `IProviderAdapter`. Capabilities object declares
   what the provider supports.
2. `NormalizedEvent` is the inter-provider event shape — sized for
   "items + content deltas + requests" because all four providers we
   surveyed structure output that way.
3. 4-PR rollout: types skeleton → claude moves behind the interface →
   renderer goes provider-agnostic → first non-claude provider (codex
   `app-server`) ships.
4. Spawn-the-binary stays universal — t3code's SDK route doesn't
   transfer to WSL / SSH.

Steps 1–3 are the gate. Without them, every new provider is a half-rewrite
of session-manager. Once they're done, "add codex / opencode / cursor /
gemini" is one PR each, mostly thin glue.

When we get there, this doc is the spec. Until then, it's the answer to
"how hard would it be to add X?".
