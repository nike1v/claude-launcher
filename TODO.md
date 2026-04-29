# TODO

Tracks open work that isn't a captured commit yet. The original
pre-MVP planning notes (Tauri scaffold, Phase 1 build, etc.) all
shipped in v0.1–v0.3 and have been removed from this doc — git
history is the source of truth for "what was the plan back then".

## Open

### Slash command autocomplete + execution
**What:** while typing in the chat input, when the user types `/` at
the start of a line offer an autocomplete dropdown for the slash
commands the underlying claude CLI supports (`/compact`, `/clear`,
`/usage`, `/init`, `/cost`, `/model`, `/agents`, `/mcp`, etc.). On
selection, send the slash line to claude's stdin so claude executes
it — same wire format as a normal user message, the CLI distinguishes.

**Open questions:**
- How do we discover the available commands? Hardcoded list per claude
  version, or scrape `/help` output once on session start? Hardcoded
  is simpler but goes stale; scraped is robust but adds a 1-shot
  startup probe.
- Some commands take arguments (`/model claude-opus-4-7`, `/agents
  list`) — the autocomplete needs to know the argument grammar to be
  useful past the command name.
- Some commands change session state in ways we'd want to surface in
  the UI (`/compact` collapses the conversation, `/clear` resets it).
  We need to either re-read the JSONL transcript after the command
  settles, or parse the assistant's confirmation event.

### Multi-provider via CLI abstraction
**What:** abstract the claude-CLI-shaped pieces of the codebase
(argv builder, stream-json parser, control protocol, transcript
layout, `/usage` scrape) behind an `IProvider` interface, so adding
a second CLI (Codex, Aider, Gemini) becomes "implement `IProvider`"
instead of "rewrite session-manager".

Detailed plan in `docs/providers.md`. Migration steps:
1. Define `IProvider` + a normalised event shape.
2. Refactor claude-specific code into `ClaudeProvider` — pure
   internal refactor, no user-visible change.
3. Renderer chat components consume normalised events instead of
   claude's native stream-json shapes — pure internal refactor.
4. Implement the second CLI as another `IProvider`. Add provider
   selection to the project / environment UI.

Steps 1–3 are the gate. Without them, every new provider is a
half-rewrite.

**Explicit non-goal — no embedded SDKs.** Claude Agent SDK was
considered as an alternative for local-only sessions (skips the
~1–2 s CLI cold-start, direct API for caching / batching / citations).
Rejected because:
- Doesn't help WSL / SSH — Agent SDK runs in our local process,
  its tools (Bash / Read / Write / Edit) execute on the local
  filesystem only. To run it on a remote we'd have to spawn it
  there, which is functionally identical to spawning the CLI.
- Splits the architecture into "in-process for local, child process
  for remote" — two ways to do everything, more surface area.
- Loses the user's existing claude setup (credentials, MCP servers,
  hooks, plugins) — we'd need to read / mirror `~/.claude/` ourselves.

Spawn-the-binary stays the universal pattern for every provider.

## Deferred / nice-to-have (no urgency)

- **Search across chat history** — browse / grep the JSONL transcripts.
  Open question: scope per-project, per-environment, or global.
- **Export current chat to markdown / clipboard** — top-of-chat menu.
- **Manage / prune saved conversations** — pairs with `lastClaudeSessionId`
  reset, lets the user list / delete transcripts on the env.

## Closed (recent shipped work)

See git log for details. Quick index:

- v0.4.37 — runtime validators for persisted JSON
- v0.4.38 — `docs/providers.md` (multi-provider planning)
- v0.4.36 — pruned debug breadcrumbs from restoreTabs
- v0.4.35 — session-id autocomplete + soft validation in project edit
- v0.4.33 — editable session id in project settings; ConfirmDialog
- v0.4.32 — reset-conversation hover button on project rows
- v0.4.30 — copy via `clipboard:write` IPC (preload sandbox restrictions)
- v0.4.28 — instant tab paint on cold restore (sync `startSession` +
  background `_runSession`)
- v0.4.25 — Ctrl/Cmd+/-/0 zoom, high-contrast theme, mac-shortcut
  parity
- v0.4.20 — accent palette picker (six colour families × three themes)
- v0.4.17 — system / light / dark theme picker
- v0.4.14 — strip trailing slash from history-reader slug (RCE
  diagnostic)
- v0.4.8 — whole-codebase review fixes (SSH `$(…)` RCE, sessionId
  path-traversal, more)
- v0.4.4 — phase-2 security/leak/memory hardening (BrowserWindow
  sandbox, validators, bounds)
