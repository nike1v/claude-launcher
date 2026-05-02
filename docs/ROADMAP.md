# Roadmap & status

A single-page snapshot of where the launcher is and what's left to
ship. Read this first when you come back to the project after a
break — it should tell you what to pick up next without diving into
git log. Detailed workstreams and shipped-work changelog live in
[`TODO.md`](../TODO.md). Provider quirks live in
[`POSSIBLE-ISSUES.md`](../POSSIBLE-ISSUES.md).

Last refreshed: **2026-05-02**, after v0.7.14.

---

## Where we are

The launcher today supports four providers end-to-end on local /
WSL / SSH:

| Provider | Live chat | History replay | Notes |
|----------|-----------|----------------|-------|
| **claude** | ✅ | ✅ JSONL transcripts | Original target; full feature set |
| **codex** | ✅ | ✅ rollout files (v0.7.12+) | UUID session ids; $CODEX_HOME/sessions |
| **opencode** | ✅ | ✅ session/load replay (v0.7.11+) | sess_* ids; auth via `opencode auth login` |
| **cursor** | ⚠️ requires subscription | ✅ when sessions exist | Falls back to session/new on stale ids |

What's solid: tab restore, project / env management, message
timestamps (24h/12h toggle), provider-aware UI copy, accent
palettes, theme picker, zoom, stale-busy detection, message
attachments, model field per-provider hints.

What's brittle: see [Known fragile points](#known-fragile-points).

---

## Pre-public gates

These are the two things that, if a stranger downloaded the
launcher today, would burn them within the first session.
Everything else can ship after public.

### 1. Stop button — production-verified

**Status:** designed in **v0.7.9**, never battle-tested under
the case that matters most. The 1312-second auto-compact freeze on
2026-05-02 is the canonical failure mode — and we don't yet know if
the new design rescues a wedged session vs. just looking right in
unit tests.

**The 0.7.9 design:**
- New `'interrupting'` status between Stop click and provider's
  `turn.completed`
- Main-side block on `sendMessage` while interrupting (no piling
  messages into stdin behind a stuck turn)
- Idempotent click (multiple clicks don't multi-send the protocol
  message)
- No auto-kill (every prior auto-escalation either hung the UI or
  regressed spawn — close-tab is the user's escape hatch)

**Acceptance test matrix (must all pass):**
- Stop on a normal active turn → spinner clears within ~100 ms,
  next message sends fine.
- Stop during auto-compact → either claude honours and clears, or
  user can close-tab to recover (no zombie state).
- Stop on a wedged tool call → same.
- Stop double-click during interrupting → no extra protocol bytes,
  no escalation, button shows "already sent" state.
- Send while interrupting → blocked client AND server side.
- Across all 4 providers — the protocol message is provider-
  agnostic but symptoms might differ.

**Pairs with:** auto-compact detection (see Open Work § Auto-compact
positive signal). Stop is the "out"; the user needs to know when
to reach for it.

### 2. Permissions UI — uniform across providers

**Status:** not started, except a stub `PermissionPrompt` component
that handles claude's `permission-prompt-tool` flow only.

**Per-provider request shapes (today):**

| Provider | Wire shape | Status in launcher |
|----------|-----------|-------------------|
| claude | `tool_use` block with name containing "permission" → `tool_result` reply with allow / deny | Partial impl, untested under load |
| codex | `commandExecution.approval` / `fileChange.approval`, distinct reply vocabs (`approved`/`approve`, `approved_for_session`/`approve_for_session`, etc.) | Not wired ([POSSIBLE-ISSUES.md §2](../POSSIBLE-ISSUES.md)) |
| ACP (cursor/opencode) | server-initiated `session/request_permission` with `options[]`: `allow_once`, `allow_always`, `reject_once`, `reject_always` | Adapter decodes; renderer surfaces `request.opened` but UI side unverified end-to-end |

**Acceptance:** for each provider, a tool that requires permission
(write a file, run a command, fetch a URL) shows a card in the chat
with **Allow once / Allow for session / Decline**, plus any
"don't ask again" affordance the protocol exposes. Click maps to
the right wire vocab; declines surface a clear "tool was denied"
follow-up.

**Acceptance — the ugly cases:**
- Permission arrives mid-stream, user ignores it for 10 min, comes
  back → UI still shows the card, decision still works.
- User closes the tab while a permission is pending → agent gets
  cancellation cleanly, no orphaned process.
- Multiple concurrent permission requests in one turn (claude can
  do this) → UI queues / stacks them.

---

## Open work (post-public, prioritized)

1. **Auto-compact detection — positive signal**
   When claude's auto-compaction kicks in, the session sits silent
   for 30+ minutes. Today the user sees "claude is thinking…"
   indistinguishable from a hang. Detect the auto-compact event in
   stream-json and surface as a distinct status (`'compacting'`?)
   with progress text. Pairs with Stop pre-public gate.

2. **Slash command autocomplete + execution**
   `/compact`, `/clear`, `/usage`, `/init`, `/cost`, `/model`,
   `/agents`, `/mcp`. Type `/` → dropdown. Selection sends the
   slash line through stdin, claude executes it. Open question:
   hardcoded list per claude version, or scrape `/help` once on
   session start?

3. **Codex transcript listing for autocomplete**
   We have replay (v0.7.12), but no enumeration of past sessions.
   Codex stores rollouts under `$CODEX_HOME/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl`
   — flat-list and dedupe by sessionId in filename suffix.

4. **Cold-restore stuck on ACP** — watch for recurrence.
   Partially fixed in v0.7.11 (history replay works,
   session-not-found fallback for cursor). If a wedged restore
   happens again, `acp-debug.log` should show the exact wire
   trace; permanent diagnostic since v0.7.10.

---

## Deferred / nice-to-have (no urgency)

- **MessageList virtualization** — only matters past ~200-turn
  chats; React.memo + compact replay events brought tab-switching
  from "noticeable" to "tolerable". Sketch in TODO.md.
- **Search across chat history** — JSONL transcripts grep. Open
  question: per-project / per-env / global scope.
- **Export current chat to markdown / clipboard** — top-of-chat
  menu.
- **Manage / prune saved conversations** — pairs with
  `lastSessionRef` reset, lets user list / delete transcripts on
  the env.

---

## Known fragile points

Things that have broken in production before and will break again
under the wrong conditions. Not bugs to fix — caveats to remember
when something starts behaving oddly.

### wsl.exe argv handling
`wsl.exe -d <distro> -- bash -c <script>` does NOT actually run bash
directly when the WSL user has a non-bash login shell — wsl.exe
forwards through that shell first. Symptom: any `*` / `?` in the
script gets eaten by the outer shell (zsh's `nomatch` fired in
v0.7.13 against codex history lookup). Workaround: use single
quotes for any glob pattern, or switch to `wsl.exe -d <distro> -e bash -c <script>`
which uses execve and bypasses the user shell entirely. The codex
history path uses `-e`; everything else still uses `--` and works
because none expose globs to the outer shell.

### Process kill on Windows
Node's `process.kill()` on Windows = `TerminateProcess` — there
are no real signals. For `wsl.exe` / `ssh.exe` wrappers the inner
CLI may not get the kill, leading to "I clicked stop but it's still
running" symptoms. We deliberately don't auto-kill on Stop because
of this; close-tab is the explicit "tear it all down" path.

### Auto-update lag
electron-updater downloads in background but applies on next
launch. Closing the window doesn't quit on Windows by default —
user has to quit the tray icon for an update to take effect.
Multiple times we've debugged a "fix didn't ship" report that
turned out to be the user running an older build.

### Cross-provider session ID incompatibility
claude UUIDs, codex `thr_*` ids, and ACP `sess_*` ids look similar
but are not interchangeable. The provider picker in `AddProjectModal`
locks when a session is pinned (since v0.5.4) so this can't slip
through the UI. Don't unlock it without a migration story.

### Env scrubbing on remote vs local
`envScrubList` is only consulted by the WSL / SSH transports —
local spawns inherit the launcher's env unchanged. If we ever
generalise scrubbing to local, codex / opencode auth via env vars
(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) will silently break. See
[POSSIBLE-ISSUES.md §4](../POSSIBLE-ISSUES.md).

### Subagent context jitter
StatusBar meter walks `tokenUsage.updated` events backwards and
picks the most recent. Subagent (Task tool) emissions have their
own much smaller context, so the meter flickers between main-agent
and subagent values. Cosmetic, logged but not yet tagged at parse
time.

### ACP debug log file
Permanent diagnostic at `<userData>/acp-debug.log`, capped at 1 MB
with one rotation. Records every JSON-RPC line for cursor /
opencode sessions. If a user reports an ACP issue, ask for this
file — it's been the unblocker for every recent ACP bug.

---

## Open bugs (lower priority than pre-public gates)

### Stale "thinking" status after Windows hard-restore
Reported 2026-04-30. Laptop died, Windows restored apps, launcher
came back showing busy spinner on a session whose underlying
process is gone. Hypotheses: hibernate preserved renderer
in-memory `status === 'busy'` without an IPC update, or the
cold-restored tab is replaying a transcript whose last event is
mid-turn. Fix direction: on cold restore, force every restored
session's status to `'starting'` until probe + spawn settle.

### Subagent context jitter — see fragile points above
Same root cause; tracked here so it isn't forgotten when we touch
StatusBar next.

---

## Recent shipped work index

For full version-by-version commits see `git log`. High-signal
landmarks:

- **v0.7.14** — codex history lookup survives WSL shell-routing
  through zsh (single-quoted find pattern + `wsl.exe -e bash`)
- **v0.7.12** — codex history replay from JSONL rollouts (codex
  rollout envelope parser + provider-aware HistoryReader)
- **v0.7.11** — ACP history replay (opencode `session/load`
  replays past messages via `session/update`; session-not-found →
  `session/new` fallback for cursor)
- **v0.7.9** — complete Stop redesign (pre-public gate, needs
  production verification)
- **v0.7.8** — skip authenticate for opencode (returns "not
  implemented" by design)
- **v0.7.0–v0.7.5** — opencode resolution and probe-vs-spawn PATH
  saga (settled on `$HOME`-based prepend captured at probe time)
- **v0.6.0–v0.6.3** — Stop iterations (v0.6.0 escalation reverted
  in v0.6.1, graded feedback in v0.6.2, stale-busy in TabBar +
  sidebar in v0.6.3)
- **v0.5.0–v0.5.4** — multi-provider rollout (codex / cursor /
  opencode landed; per-project provider override; locked-picker
  on saved sessions)
