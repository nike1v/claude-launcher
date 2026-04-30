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
**What:** abstract the claude-CLI-shaped pieces of the codebase behind
two interfaces — `IProvider` (lifecycle: spawn args, send message,
interrupt, capabilities) and `IProviderAdapter` (wire-format translation:
provider stdout → `NormalizedEvent`) — so adding Codex, opencode, or
Cursor becomes "implement two interfaces" instead of "rewrite
session-manager".

Detailed plan in `docs/providers.md`. 4-PR rollout:
1. **PR 1** — types skeleton: `IProvider`, `IProviderAdapter`,
   `ProviderCapabilities`, `NormalizedEvent` union, registry.
   `Project.providerKind?: ProviderKind` optional, defaults to claude.
2. **PR 2** — refactor claude into `ClaudeProvider` + `ClaudeAdapter`.
   Pure internal refactor, no user-visible change.
3. **PR 3** — renderer consumes `NormalizedEvent` (item / content /
   request taxonomy) instead of claude's native stream-json. Field
   rename `lastClaudeSessionId` → `lastSessionRef`.
4. **PR 4** — first non-claude provider: **Codex via `codex app-server`**
   (stdio JSON-RPC). Provider picker in project UI.

Steps 1–3 are the gate. Without them, every new provider is a half-rewrite.

**Design borrows from t3code** (`pingdotgg/t3code`): provider/adapter
split, capability flags, four-state approval decisions
(`accept | acceptForSession | decline | cancel`), richer event taxonomy
with `item.*` / `content.delta` / `request.*` / `turn.*`. Their
SDK-based code paths (`@anthropic-ai/claude-agent-sdk`,
`@opencode-ai/sdk`) don't transfer — those don't reach WSL / SSH.

**Explicit non-goal — no embedded SDKs.** Spawn-the-binary stays the
universal pattern. Modern AI CLIs are converging on stdio JSON-RPC
subcommands (codex `app-server`, cursor `agent acp`) for exactly this
host-to-agent integration use case, so the spawn pattern fits cleanly.

## Deferred / nice-to-have (no urgency)

### MessageList virtualization
**What:** render only the visible slice of message rows; keep the rest
as off-DOM placeholders. Today MessageList renders every message
component for every event in the session's events array — at 200+
turns the initial mount of a tab is visibly slow (hundreds of
`<AssistantMessage>` / `<ToolUse>` subtrees, each with its own
ReactMarkdown / Lexical / lucide tree).

**Why deferred:** the alpha.8 React.memo pass + alpha.9 compact
replay events brought tab-switching from "noticeable" to "tolerable"
on multi-hundred-turn chats. Virtualization is the next lever and
has the right semantics (the user is always at the bottom of a long
chat anyway), but it's a chunky change — react-window or
react-virtuoso, sticky scroll-to-bottom, ResizeObserver coordination,
matching the existing ToolGroup collapsing — and we don't yet have a
sharp pain point that justifies it. Revisit when somebody complains
again or when we want to support multi-thousand-turn sessions.

**Sketch when we do it:**
- One row per RenderGroup (the existing groupMessages output) so
  ToolGroup remains a single virtual row with its child tools inside
  rather than getting un-grouped by the virtualizer.
- Variable row heights — react-virtuoso handles this without
  upfront measurement.
- Keep the bottom-pinned scroll behaviour: virtuoso's
  `followOutput="auto"` does this natively.
- Adapter / store layer doesn't change — virtualization is purely
  inside MessageList.

### Search across chat history
**What:** browse / grep the JSONL transcripts. Open question: scope
per-project, per-environment, or global.

### Export current chat to markdown / clipboard
Top-of-chat menu.

### Manage / prune saved conversations
Pairs with `lastSessionRef` reset, lets the user list / delete
transcripts on the env.

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
