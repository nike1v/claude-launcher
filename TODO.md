# TODO

Tracks open work that isn't a captured commit yet. The original
pre-MVP planning notes (Tauri scaffold, Phase 1 build, etc.) all
shipped in v0.1–v0.3 and have been removed from this doc — git
history is the source of truth for "what was the plan back then".

## Pre-public (must ship before we call this v1 / public-ready)

These two are the things that, if a stranger downloaded the launcher
today, would burn them within the first session. Everything else can
follow.

### 1. Stop button — production-verified

**Status:** designed in 0.7.9, never actually battle-tested. The
production case where Stop matters most is exactly the auto-compact
freeze (1312-second stuck "thinking…" we hit on 2026-05-02 in this
very chat). We don't yet know if the 0.7.9 design (`'interrupting'`
status + main-side `sendMessage` block + idempotent click + no
auto-kill) holds up there.

**Test matrix that has to pass before we call this done:**
- Stop on a normal active turn → spinner clears within ~100 ms,
  next message sends fine.
- Stop during auto-compact → either claude honours and clears, or
  user can close-tab to recover (no zombie state).
- Stop on a wedged tool call → same.
- Stop double-click during interrupting → no extra protocol bytes,
  no escalation, button shows "already sent" state.
- Send while interrupting → blocked client and server side.
- Across all 4 providers (claude, codex, cursor, opencode) — the
  protocol message is provider-agnostic but the symptoms might
  differ.

**Likely follow-up:** auto-compact detection (see below) is the
deeper fix — Stop is the "out" but the user needs to know when
they need to reach for it.

### 2. Permissions UI — uniform across providers

**Status:** not started, except a stub `PermissionPrompt` component
that handles claude's `permission-prompt-tool` flow only. The other
three providers each emit permission requests with their own shape,
and we don't yet have a tested unified path:

- **claude** — `tool_use` with name containing "permission" → reply
  via tool_result with allow/deny. Partial impl, untested under load.
- **codex** — `commandExecution.approval` and `fileChange.approval`,
  each with their own reply vocabularies (`approved`/`approve`,
  `approved_for_session`/`approve_for_session`, etc.) per
  POSSIBLE-ISSUES.md §2. Not wired.
- **ACP (cursor / opencode)** — server-initiated
  `session/request_permission` with `options[]` carrying ids like
  `allow_once`, `allow_always`, `reject_once`, `reject_always`.
  Adapter side decodes via `pickPermissionOptionId`; the renderer
  surfaces `request.opened` as a NormalizedEvent but the UI side
  hasn't been verified end-to-end.

**Acceptance:** for each provider, a tool that requires permission
(write a file, run a command, fetch a URL) shows a card in the chat
with **Allow once**, **Allow for session**, **Decline**, plus any
"don't ask again" affordance the protocol exposes. Click maps to
the right wire vocab; declines surface a clear "tool was denied"
follow-up message.

**Acceptance — the ugly cases:**
- Permission prompt arrives mid-stream, user ignores it for 10 min,
  comes back — UI still shows the card, decision still works.
- User closes the tab while a permission is pending — agent gets
  cancellation cleanly, no orphaned process.
- Multiple concurrent permission requests in one turn (claude can
  do this) — UI queues / stacks them.

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

## Bugs to investigate

### Cold-restore on ACP providers (cursor / opencode) lands in stuck "thinking…"
Reported 2026-05-02. After full launcher restart, opencode and cursor
tabs that were open before the restart come up in the busy spinner
state with no user input — and stay there indefinitely (487 s and
counting in the screenshot). claude tabs restore fine.

Hypothesis: our `session/load` flow on cold restore for ACP
providers might either resume an in-progress turn from before the
shutdown, or get stuck waiting on a response the agent doesn't
actually send. acp-debug.log will show the exact wire trace —
restored that diagnostic in 0.7.10. Need user to reproduce and
share log.

Fix directions (depending on what the log shows):
- Skip auto-resume on cold restore for ACP, treat each restart as
  a fresh `session/new`. Loses conversation continuity but never
  hangs.
- If the log shows a specific session/load error response we're
  swallowing, surface it as a session-error status (not stuck
  busy).
- If session/load succeeds but no follow-up events, force a status
  flip to 'ready' after a short timeout post-load and let the user
  type the next message.

### Codex transcript listing not implemented
The Edit Project dialog used to claim "no transcript with this id
found in ~/.claude/projects/" for every provider; 0.7.10 hides the
autocomplete + transcript-dir hint for non-claude. Long-term we
want codex sessions enumerable too. Codex stores rollouts under
`$CODEX_HOME/sessions/<thr_*>.jsonl` per the codex-rs README.
We'd need:
- A per-provider `listSessions(env, project)` IPC (today it's
  hardcoded to the claude path under fs:listSessionIds)
- Codex-specific path hint in the modal
- ACP keeps state inside the agent — would need an HTTP/JSON-RPC
  list endpoint we don't currently call, defer.

### Stale "thinking" status after Windows app-restore from a hard crash
Reported 2026-04-30. User's laptop died (out of battery). Windows
restored open apps; claude-launcher came back showing the chat as
still processing (busy spinner visible) on a session that couldn't
plausibly still be running — the underlying claude process is gone
along with everything else.

Hypotheses:
- The renderer state was preserved across hibernate / fast-startup so
  the in-memory `status === 'busy'` survives the wake without a fresh
  IPC update. session-manager isn't there to fire a status flip
  because main was killed too.
- Or the cold-restored tab is replaying a transcript whose last event
  is mid-turn (no result event ever flushed) and something downstream
  reads that as "still streaming".

To reproduce: start a long claude turn, force-kill the launcher /
machine while the assistant is mid-stream, relaunch, restore tabs.
Check whether `session.status` ends up `busy` and whether the
spinner stays.

Fix direction (once confirmed): on cold restore, force every restored
session's status to a non-busy state (probably `'starting'` until the
probe + spawn settle, never carrying any prior busy through) and
ignore any persisted busy flag.

### Context-fill meter jumps wildly mid-session (subagent bleed-through)
Reported 2026-05-01. User observed the meter swinging between
~100k → ~950k → ~48k → ~420k across consecutive messages within one
session.

Cause: `StatusBar.computeContextFill`
(`src/renderer/src/components/StatusBar/StatusBar.tsx:58-98`) walks
the event stream backwards and picks the most recent
`tokenUsage.updated` event. The claude adapter
(`src/main/providers/claude/adapter.ts:209-220`) emits one of these
on every assistant message — including assistant messages produced
by **subagents** (Task tool delegations). Subagents have their own
small context window distinct from the main agent's, so when a
subagent fires its meter overwrites the display with its much
smaller `used`/`contextWindow` numbers; when the main agent resumes,
the next assistant event flips it back. The 100k/950k/48k/420k
pattern is exactly main-agent vs subagent values interleaving.

Fix directions:
- Tag `tokenUsage.updated` events with a `scope: 'main' | 'subagent'`
  field at adapter parse time (claude stream-json identifies
  subagent assistant messages — they're inside Task tool result
  envelopes), and have `computeContextFill` filter to `scope === 'main'`.
- Alternatively, key the meter on session/turn boundary events
  rather than the latest tokenUsage event — only update on the
  outermost `turn.completed`.

### Auto-compact detection (positive signal)
Same root family as STOP — when claude's auto-compaction kicks in
the session sits on the busy spinner for 30+ minutes with no events.
Fix direction: detect claude's auto-compact event in stream-json,
surface it as a distinct status (`compacting`?) with progress text
so the user knows whether to wait or bail out via Stop. Pair this
with a fixed STOP so the bail-out path actually works.

## Known fragile points

Things that have broken in production before and will break again
under the wrong conditions. Not bugs to fix — caveats to remember
when something starts behaving oddly.

### wsl.exe argv handling
`wsl.exe -d <distro> -- bash -c <script>` does NOT actually run bash
directly when the WSL user has a non-bash login shell. wsl.exe
forwards through that shell first. Symptom: any `*` / `?` glob
character in the script gets eaten by the outer shell (zsh's
`nomatch` fired in 0.7.13 against codex history lookup). Workaround:
use single quotes for any glob pattern, or switch to
`wsl.exe -d <distro> -e bash -c <script>` which uses execve and
bypasses the user shell entirely. The codex history path uses `-e`;
everything else still uses `--` and works because none of them
expose globs to the outer shell.

### Process kill on Windows
Node's `process.kill()` on Windows = `TerminateProcess` — there are
no real signals. For `wsl.exe` / `ssh.exe` wrappers the inner CLI
may not get the kill, leading to "I clicked stop but it's still
running" symptoms. We deliberately don't auto-kill on Stop because
of this; close-tab is the explicit "tear it all down" path.

### Auto-update lag
electron-updater downloads in background but applies on next launch.
Closing the window doesn't quit on Windows by default — user has to
quit the tray icon for an update to take. Multiple times we've
debugged a "fix didn't ship" report that turned out to be the user
running an older build.

### Cross-provider session ID incompatibility
claude UUIDs, codex `thr_*` ids, and ACP `sess_*` ids look similar
but are not interchangeable. The provider picker in AddProjectModal
locks when a session is pinned (see 0.5.4) so this can't slip
through the UI.

### Env scrubbing on remote vs local
`envScrubList` is only consulted by the WSL / SSH transports. Local
spawns inherit the launcher's env unchanged. If we ever generalise
scrubbing to local, codex / opencode auth via env vars
(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) will silently break — see
POSSIBLE-ISSUES.md §4.

### Subagent context jitter
StatusBar meter walks `tokenUsage.updated` events backwards and
picks the most recent. Subagent (Task tool) emissions have their
own much smaller context, so the meter flickers between main-agent
and subagent values. Cosmetic, logged but not yet tagged at parse
time.

## Closed (recent shipped work)

See git log for details. Quick index:

- v0.7.14 — codex history lookup survives WSL routing through
  zsh login shell (single-quoted find pattern + wsl.exe -e bash)
- v0.7.13 — better diagnostics on codex history lookup failures
  (find script reports matched path / not-found reason via stderr)
- v0.7.12 — codex history replay from JSONL rollouts (codex
  rollout envelope parser + provider-aware HistoryReader)
- v0.7.11 — ACP history replay (opencode session/load replays
  past messages via session/update; user_message_chunk handler;
  session-not-found → fall back to session/new for cursor)
- v0.7.10 — provider-aware Session ID UI in Edit Project dialog;
  restored acp-debug-log as permanent diagnostic
- v0.7.9 — complete Stop solution: 'interrupting' status,
  send-block, idempotent click, no auto-kill (PRE-PUBLIC GATE)
- v0.7.8 — skip authenticate for opencode (returns "not implemented")
- v0.7.7 — temporary debug log file for ACP traffic (folded into
  the 0.7.10 permanent restoration)
- v0.7.6 — per-palette accent foregrounds; UpdatePill readable on
  amber
- v0.7.5 — WSL spawn unconditionally prepends installer dirs via
  cached HOME (final opencode resolution fix)
- v0.7.4 — revert 0.7.1 bash -c spawn (broke WSL chats end-to-end)
- v0.7.3 — fix folder autocomplete tilde expansion + attachments
  above text in user messages
- v0.7.2 — provider-aware copy in chat label / input placeholder /
  busy hints (no more "Message claude…" on a codex tab)
- v0.7.1 — auto-close tabs on project delete
- v0.7.0 — probe unconditionally prepends installer dirs via $HOME
- v0.6.3 — Stale-busy detection now visible from TabBar and the
  sidebar, not just the active chat: a small warn-tinted ⚠ glyph
  appears next to the status dot on tabs/projects whose session has
  gone 30 s without an event while busy. Lifted `lastEventAt` to the
  messages store; new `useStaleBusy(sessionId)` hook is the shared
  source of truth.
- v0.6.2 — Stop button gives graded feedback: spinner caption flips
  to "stop sent — claude is wrapping up…" on click, then to "stop
  sent Ns ago — not acknowledged yet…" after 5 s if the turn hasn't
  ended, with a warn-tinted hint to close the tab. Cleared
  automatically when status flips off busy. Provider-agnostic — no
  control_response parsing needed; the existing turn.completed →
  ready transition is the success signal.
- v0.6.1 — Stop button is now plain "send in-band interrupt" and
  nothing else (reverted the 0.6.0 escalation ladder — the user just
  wanted a cancel-current-action button, not multi-stage SIGTERM /
  SIGKILL). Added stale-busy hint in MessageList instead: after 30 s
  of no events while busy, surfaces "session may be unresponsive,
  close the tab" so a wedged session is at least visible.
- v0.6.0 — STOP escalation ladder (reverted in 0.6.1).
- v0.5.9 — Settings → Appearance now has a 24h/12h clock-format
  toggle that drives the message timestamps and their hover tooltips.
  Persists in localStorage; default 24h.
- v0.5.8 — force 24h timestamps universally (Electron locale
  detection didn't track host OS preference reliably). Superseded
  by 0.5.9's explicit setting.
- v0.5.7 — message timestamps: HH:MM rendered next to user and
  assistant bubbles, full date on hover. JSONL replay uses the
  original ISO timestamp from disk; live and InputBar local pushes
  stamp `Date.now()`.
- v0.5.6 — revert 0.5.5 STOP watchdog (UI hung in `interrupting`,
  second click didn't escalate — re-logged as separate bug);
  ProjectItem now inherits `lastUsedTokens` from the project record
  on click (was previously only flowing through the tabs.json
  restore path).
- v0.5.5 — cold-restore context meter (persist `lastUsedTokens`).
  STOP watchdog also shipped here, reverted in 0.5.6.
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
