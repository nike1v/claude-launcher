# Adding new LLM providers

This doc sketches what it takes to add a second provider (Codex CLI, Aider,
Gemini CLI, direct Anthropic SDK, etc.) alongside the current `claude` CLI
transport. It's the deliverable that gates real "let's add provider X" work
— so we go in with the right scope already mapped, instead of finding the
hard parts halfway through implementation.

The launcher today is **claude-shaped end-to-end**: every transport spawns
the `claude` binary, every parser expects claude's `--output-format
stream-json`, every UI surface assumes claude's permission-prompt protocol
and resume conventions. Generalising means picking apart which of those
assumptions are load-bearing for the user experience and which are
incidental implementation choices.

This is a planning doc, not a checklist. There's no v0.5 deliverable
attached. Use it when the question "what would it take to add Aider?"
actually comes up.

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

So the work is in two layers:

1. **A new `IProvider` abstraction** that captures the claude-shaped
   parts (argv, stream format, control protocol, resume convention,
   transcript layout). `ITransport` stays where it is — it's
   provider-agnostic.
2. **Per-feature decisions** about what a non-claude provider does
   for the UI surfaces that don't translate (no `/usage` for an
   Aider session, no `--resume` for Gemini CLI, etc.).

---

## A possible `IProvider` shape

```ts
// src/main/providers/types.ts (proposed)
export interface IProvider {
  // Display id ('claude', 'codex', 'aider', 'gemini', 'anthropic-sdk').
  // Persisted on Environment / Project so we know which provider to
  // construct when restoring tabs.
  readonly id: string

  // Human-readable name shown in the UI. 'Claude Code', 'OpenAI Codex',
  // 'Aider', etc.
  readonly label: string

  // Which transports this provider supports. Most CLIs work over local /
  // WSL / SSH. A direct-SDK provider only supports `local` (no child
  // process at all — runs in the main process or hits the API directly).
  readonly supportedTransports: ReadonlyArray<HostType['kind']>

  // Where the provider stores its on-disk transcripts, if anywhere. null
  // means "no transcripts" (direct-SDK probably keeps nothing on disk;
  // some CLIs might log to stderr only).
  transcriptDir(host: HostType, projectPath: string): string | null

  // Build the argv for `transport.spawn`. The transport handles host
  // wrapping (ssh foo bar — bash -lc, wsl.exe -d distro --, etc.); the
  // provider just builds the inner argv for its own binary.
  buildSpawnArgs(opts: ProviderSpawnOpts): { bin: string; args: string[] }

  // Pre-flight check — `<binary> --version`-equivalent. Returns the
  // version string on success, an error reason otherwise.
  probeBinary(): Promise<ProbeResult>

  // Parses one line / chunk of provider stdout into a renderer-agnostic
  // event. Each provider speaks its own wire format — claude does
  // stream-json with discriminated `type` fields, Aider does plain
  // text with markers, OpenAI Responses API does SSE, etc.
  parseLine(line: string): NormalizedEvent | null

  // Format a user message for stdin. Claude takes
  // `{type:'user', message:{role:'user', content: string|blocks}}` JSON
  // lines; Aider takes plain text terminated by Enter; an SDK provider
  // takes a structured Message object.
  formatUserMessage(text: string, attachments: SendAttachment[]): string

  // Translate the renderer's high-level intents into provider-specific
  // control commands. `interrupt` is the obvious one (claude:
  // control_request/interrupt; Aider: ^C; SDK: AbortController.abort()).
  // `respondPermission` only applies to providers that have a permission
  // prompt at all.
  controlCommand(cmd: ControlCommand): string | null
}

export interface ProviderSpawnOpts {
  cwd: string
  model?: string
  resumeSessionId?: string  // null when provider has no resume concept
  // Provider-specific extras can ride along — each provider knows what
  // to do with them, others ignore.
  extra?: Record<string, unknown>
}

export type ControlCommand =
  | { kind: 'interrupt' }
  | { kind: 'permission'; toolUseId: string; decision: 'allow' | 'deny' }
```

The current claude implementation becomes `ClaudeProvider implements
IProvider` — pulls the argv builder, transcript path, stream-json parser,
control_request line out of where they live now. ~150 lines total moved.

`session-manager.ts` then takes `(transport, provider, ...)` instead of
just `(transport, ...)`. Renderer events flow through provider.parseLine
into a normalized shape.

---

## What's a normalized event?

Today the IPC channel `'session:event'` carries claude's `StreamJsonEvent`
union — `system`, `assistant`, `user`, `result` types with claude-specific
fields. The renderer's `MessageList` component pattern-matches on this
shape directly.

A multi-provider world needs a smaller, provider-agnostic event shape:

```ts
// shared/events.ts (proposed)
export type NormalizedEvent =
  | { kind: 'session-started'; sessionId: string; model: string }
  | { kind: 'assistant-text'; text: string; thinking?: string }
  | { kind: 'tool-call'; id: string; name: string; input: unknown }
  | { kind: 'tool-result'; toolUseId: string; content: string; isError: boolean }
  | { kind: 'permission-request'; toolUseId: string; toolName: string; input: unknown }
  | { kind: 'turn-ended'; usage?: TokenUsage; modelUsage?: ModelUsage }
  | { kind: 'error'; message: string }
```

Each provider's `parseLine` maps its native wire format to this. `MessageList`
renders this. Claude's existing event types become a translation in
`ClaudeProvider.parseLine`. The on-disk transcripts stay in claude's native
shape — that's how claude wrote them, we don't get to retroactively
normalise the historical record.

This is the **single highest-friction part of the refactor**. The current
code passes `StreamJsonEvent` through the IPC and into the React tree
unchanged. Migrating means touching every component that renders messages
(`AssistantMessage`, `UserMessage`, `ToolUse`, `Thinking`, `PermissionPrompt`,
`MessageList`'s `groupMessages` and `classify`).

---

## Per-feature decisions

These are the choices that come up when you actually start mapping a
specific provider in. Listed as a checklist so we know what the questions
are before someone asks "but how does Aider do X?".

### Resume / session continuity

| Provider     | Resume mechanism |
|---|---|
| claude       | `--resume <session-id>` flag, on-disk JSONL transcript |
| Codex CLI    | `--continue` flag, no explicit id (resumes "the last one") |
| Aider        | `--continue` per-repo conversation, persists in `.aider.chat.history.md` |
| Gemini CLI   | No native resume as of writing — fresh session every spawn |
| Anthropic SDK| Renderer keeps the conversation in memory + tabs.json; no provider call |

The `lastClaudeSessionId` field on `Project` is claude-specific. A
provider-agnostic version would be `lastSessionRef: string | null` — the
provider interprets the string however it wants, or ignores it.

### Transcript backfill

`history-reader.ts.loadSessionEvents` reads `claude/projects/<slug>/<id>.jsonl`
and parses each line through `parseStreamJsonLine`. For a provider whose
transcripts aren't JSONL, the reader needs a provider-driven parser. For
a provider with no transcripts, history is "whatever the renderer's
messages store has in memory".

`IProvider.transcriptDir(host, path)` + `IProvider.parseLine(line)` already
covers the read side — `history-reader.ts` would just dispatch through
the project's provider.

### Permission prompts

Claude announces tool-use intent and waits for `--permission-prompt-tool
stdio` to reply before continuing. Codex / Aider / Gemini have their own
interactive flow (or no flow at all — they just do the thing). The
renderer's `PermissionPrompt` component would be a no-op for providers
that don't emit `permission-request` events.

### Usage / billing

`/usage` is a claude-CLI-specific TUI panel. Other providers either don't
have it (Aider — local, no API in their CLI) or expose it differently
(OpenAI / Anthropic SDKs — REST endpoints with quota info). Settings →
Environments → Usage modal would need an `IProvider.fetchUsage()` that
returns `null` for providers without a usage notion, and the modal hides
itself for those rows.

### Model picking

`buildClaudeArgs(model, ...)` injects `--model` into the argv. Codex has
`--model`, Aider has `--model`, Gemini has `--model`, but the *valid model
strings* differ per provider. The model combobox today suggests
claude-shaped values. Each provider would expose a
`suggestedModels(): string[]` or similar.

### Stop / interrupt

Claude: `control_request/interrupt` JSON line on stdin. Most CLIs: SIGINT.
SDK: `AbortController.abort()`. The `IProvider.controlCommand` returns
either a stdin line (provider writes it via session-manager.writeStdin)
or null — null means "the session-manager should send SIGINT to the
child" (or for SDK, abort).

---

## Pieces of the codebase that would change

Concrete files, scoped roughly. **None** of these need to change unless
we actually take this on — this is just the inventory.

| File | Today | Multi-provider |
|---|---|---|
| `src/main/transports/shared.ts` | `buildClaudeArgs` | Becomes `provider.buildSpawnArgs` |
| `src/main/transports/{local,wsl,ssh}.ts` | spawn `claude` | spawn `provider.bin` with `provider.buildSpawnArgs` |
| `src/main/transports/probe.ts` | `runShellProbe` checks for "Claude Code" banner | Provider passes a regex or check fn |
| `src/main/session-manager.ts` | parses claude stream-json | Dispatches lines through `provider.parseLine` to normalised events |
| `src/main/history-reader.ts` | reads claude JSONL transcripts | Per-provider transcript reader (or none) |
| `src/main/usage-probe.ts` | scrapes claude's `/usage` TUI | Per-provider — null for most |
| `src/shared/types.ts` | `StreamJsonEvent` union | Plus `NormalizedEvent` |
| `src/shared/host-utils.ts` `transcriptDirHint` | hardcodes `~/.claude/projects` | Delegates to `provider.transcriptDir` |
| `src/renderer/src/components/Chat/*` | renders claude's event shapes | Renders `NormalizedEvent` |
| `src/renderer/src/components/Sidebar/AddProjectModal.tsx` | session id + transcripts hint | Plus a "Provider" picker; session id field shows only for providers that resume |
| `src/renderer/src/components/Settings/*` | env probe + usage modal | Both delegate through provider |

Migration order if we ever do it:

1. Define `IProvider` and `NormalizedEvent`.
2. Refactor claude into `ClaudeProvider` — the existing behaviour is
   still the only thing in the registry, so nothing changes for users.
   Tests stay green; this is pure rename + interface conformance.
3. Renderer chat components consume `NormalizedEvent` with
   `ClaudeProvider.parseLine` mapping its native shape — still
   single-provider, still nothing visible to users.
4. **Now** add a second provider. Whatever it is, the work is
   "implement `IProvider`" rather than "rewrite session-manager".

That migration order is the point. Steps 1–3 are an internal refactor
that doesn't ship a new feature. Step 4 is the actual user-visible work.
Without 1–3 done first, step 4 is "rewrite half the codebase" — which
is what makes "let's add a provider" feel like a much bigger ask than it
needs to be.

---

## What's NOT planned here

- **No support for "claude on Vertex AI" / "claude on Bedrock".** Those
  are claude with a different auth surface, not different providers.
  They'd be Environment config (extra env vars), not an `IProvider`
  variant.
- **No "agent" providers** (LangChain agents, AutoGen, custom orchestrations).
  The launcher's mental model is "one chat = one CLI process". Multi-agent
  orchestration is a different product.
- **No browser-only providers** (ChatGPT.com, Claude.ai web). Those live
  outside our process model — we can't spawn a child for them.

If any of those become real requirements, this doc gets revised before we
implement them.

---

## Open questions

These would have to be answered when we actually do this, not now:

1. **Where does provider config live?** Today the Environment carries
   `HostType` (transport) and `defaultModel` (claude-specific). A
   multi-provider world either: (a) makes provider a third axis on
   Environment, or (b) attaches provider to Project directly. Probably
   (b) — different projects on the same WSL distro might use different
   providers.
2. **What about projects that should run on multiple providers?**
   "Try the same prompt against claude and codex side by side" is a real
   workflow. The launcher's tab model is one-tab-one-process today. A
   side-by-side feature would need multi-tab-per-project plus a sync'd
   input bar. Out of scope for `IProvider` introduction — that's a
   separate feature on top.
3. **Auth.** Claude Code stores its OAuth token in `~/.claude/`, on the
   environment side. Codex authenticates via OPENAI\_API\_KEY env var.
   Aider via OPENAI\_API\_KEY too (or anthropic, or whatever model
   it's using). Gemini via GEMINI\_API\_KEY. Today we silently strip
   `CLAUDE_CODE_OAUTH_TOKEN` from the spawned env (so the remote uses
   its own creds) — generalising that filter to "strip the host's
   credentials for whatever provider's about to spawn" is a per-provider
   list of env vars.
4. **Streaming consistency.** Claude streams events line-by-line. SSE
   providers stream events as `data: {...}\n\n`. The session-manager's
   line buffer assumes newline-delimited. Per-provider would need to
   carry its own framing.

---

## TL;DR

To add a second provider:
1. Pull claude-specific code (~5 files, ~300 lines) behind an
   `IProvider` interface — pure refactor, no user-visible change.
2. Define a `NormalizedEvent` shape and rewrite the renderer chat
   components to consume it — pure refactor.
3. Implement the new provider as a second `IProvider`.
4. Add provider selection to project / environment UI.

Steps 1–2 are the gate. Once they're done, "add Codex CLI" is one PR
that's mostly thin glue. Without them, every new provider is a half-rewrite
of session-manager.

When we get there, this doc is the spec. Until then, it's the answer to
"how hard would it be to add X?".
