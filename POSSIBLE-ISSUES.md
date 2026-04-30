# Possible issues

Bounded, hypothetical bug reports — things that *might* be broken but
haven't been confirmed (usually because verification needs an external
binary / environment we don't have on the test runner). Promoted to
`TODO.md` once a real symptom is observed.

---

## Codex provider — protocol-mapping uncertainties (0.5.1)

The CodexAdapter was built against t3code's reverse-engineered schema
(`pingdotgg/t3code/packages/effect-codex-app-server`) plus the upstream
`codex-rs/app-server/README.md`. The whole pipeline is exercised
end-to-end via a bash mock that speaks the protocol
(`tests/integration/mock-codex.sh`). What the mock can't catch is
**dictionary drift** — if the upstream codex binary emits slightly
different strings than what the schema says, our mappings hit the
`unknown` fallback or send wrong reply vocabulary.

### 1. Item-type name drift in `item/started` notifications

`src/main/providers/codex/adapter.ts:mapItemType` translates codex's
item type strings to our `ItemType` union:

| codex `item.type`       | our `ItemType`        |
|-------------------------|-----------------------|
| `agentMessage`          | `assistant_message`   |
| `userMessage`           | `user_message`        |
| `reasoning`             | `reasoning`           |
| `commandExecution`      | `command_execution`   |
| `fileChange`            | `file_change`         |
| `mcpToolCall`           | `tool_use`            |
| `dynamicToolCall`       | `tool_use`            |
| `webSearch`             | `web_search`          |
| `plan`                  | `plan`                |
| anything else           | `unknown`             |

If upstream renamed any of these (e.g. to camelCase / snake_case
inconsistency, or split `mcpToolCall` into `mcp.tool_call`), the
adapter still parses the event but the renderer skips it (the
`unknown` itemType has no render path). Symptom: assistant
responses simply don't appear, even though the chat shows
`session.started` correctly.

**Fix:** install codex on a test env, capture a real session's stdout
to a file, run it through `CodexAdapter.parseTranscript`, see which
items map to `unknown`. Update the table.

### 2. Approval reply vocabulary

`src/main/providers/codex/adapter.ts:mapApprovalDecision` returns
different decision strings depending on whether the original request
was a `commandExecution` or `fileChange` approval:

| our `ApprovalDecision` | command          | fileChange             |
|------------------------|------------------|------------------------|
| `accept`               | `approved`       | `approve`              |
| `acceptForSession`     | `approved_for_session` | `approve_for_session` |
| `decline`              | `denied`         | `deny`                 |
| `cancel`               | `abort`          | `abort`                |

Both vocabularies were taken from t3code's schema. If upstream
unified them or changed any string, codex will reject our reply
with a JSON-RPC error. Symptom: clicking Allow in the permission
prompt does nothing; codex stalls waiting for a valid reply, then
errors.

**Fix:** approval reply schema lives in
`codex-rs/app-server/src/protocol/...` upstream — check current
shape next time we sync against codex updates.

### 3. Auth flow not integrated

The codex `account/*` methods (login flow, `account/read`,
`account/updated` notifications) aren't wired. The launcher spawns
codex assuming the user already authenticated via `codex login` /
`OPENAI_API_KEY` outside the launcher.

If the user spawns codex unauthenticated, codex's first response to
`initialize` should still succeed but `thread/start` will likely
error. We surface that error via the existing JSON-RPC error path,
so the user sees something — but they won't get a chance to
authenticate inside the launcher.

**Fix direction:** Settings → Environments could route
`account/login/start` through the adapter when a user clicks "Sign
in to OpenAI". Out of scope for the multi-provider abstraction
itself; this is a feature on top.

### 4. `OPENAI_API_KEY` is in the env-scrub list

`CodexProvider.envScrubList` strips `OPENAI_*` and `CODEX_HOME` from
the spawned env when running on a remote, mirroring the
`CLAUDE_CODE_*` scrub for claude. The reasoning is the same: the
remote has its own auth, the launcher's local env shouldn't override.

But for **local** sessions, this means a user who set `OPENAI_API_KEY`
in their shell, then launched the launcher from a non-shell context
(macOS `.app` bundle, Windows shortcut), might find codex
unauthenticated even though the env var is "in their PATH" from a
terminal perspective.

This isn't actually a bug today — `envScrubList` is only consulted
by the WSL / SSH transports' env filter (see
`transports/shared.ts:filteredEnvFor`). Local transport spawns with
the inherited env unchanged. But it's a near-miss — if anyone ever
generalises the env-scrub to local in the future, codex's local auth
will silently break.

**Fix direction:** if we generalise scrubbing, add a host-aware
check inside `CodexProvider.envScrubList` (return `[]` for
`host.kind === 'local'`).

---

## Conventions

- One `## Section` per logical area (provider, transport, etc.).
- `### N. <Symptom>` numbered subsections so cross-references work.
- Each subsection ends with a **Fix:** or **Fix direction:** line so a
  future-you reading this knows where to start.
- Promote to `TODO.md` once a real user reproduces the symptom.
