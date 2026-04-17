# TODO

## Phase 0 — spike / validation

- [ ] Confirm `claude --output-format stream-json --input-format stream-json` works **without** any `CLAUDE_CODE_*` env vars and uses the host's `~/.claude/credentials.json` for auth. Test on WSL.
- [ ] Confirm the same via `wsl.exe -d <distro> --cd <path> -- claude …` from a Windows terminal.
- [ ] Confirm the same via `ssh user@host 'cd <path> && claude …'` from a Windows terminal.
- [ ] Document the stream-json event shapes we need to render (user msg, assistant delta, tool_use, tool_result, error, permission request, end-of-turn).

## Phase 1 — MVP app

### Scaffolding
- [ ] Pick stack: Tauri + React + TypeScript (default) — confirm or swap.
- [ ] `npm create tauri-app@latest` → scaffold in repo root.
- [ ] Set up basic CI: `cargo check`, `npm run build`, format/lint.
- [ ] Decide on project-config file location (`%APPDATA%/claude-launcher/projects.json`).

### Projects UI
- [ ] Sidebar listing projects with name + host label.
- [ ] "Add project" form: name, host type (Local / WSL / SSH), path, optional model.
- [ ] Edit / delete project.
- [ ] Persist projects to disk.

### Tab manager
- [ ] Open project → create new tab.
- [ ] Tab bar with close button.
- [ ] Multiple tabs live simultaneously (independent subprocesses).
- [ ] Remember last-opened tabs on app restart (optional).

### Transport layer (Rust)
- [ ] `Host::Local` — spawn `claude.exe` via `tokio::process::Command`, piped stdin/stdout.
- [ ] `Host::Wsl { distro }` — spawn via `wsl.exe -d <distro> --cd <path> -- claude …`.
- [ ] `Host::Ssh { user, host, port, keyFile }` — spawn via system `ssh` with stdin/stdout piped. (Consider `russh` later for native SSH.)
- [ ] Line-buffered JSON stream reader; forward each event to the frontend via Tauri events.
- [ ] Graceful kill on tab close (signal + fallback timeout).

### Chat UI
- [ ] Render assistant message deltas.
- [ ] Render user messages (input box → send → stream-json request).
- [ ] Render tool use (collapsed by default, expandable).
- [ ] Render tool results.
- [ ] Render errors.
- [ ] Permission prompt UI (approve / deny).
- [ ] Scroll-to-bottom on new content, with "follow" toggle.
- [ ] Per-tab loading state while `claude` spins up.

### Polish
- [ ] App icon, window chrome, basic theme (dark/light).
- [ ] Keyboard shortcuts: `Ctrl+T` new tab, `Ctrl+W` close tab, `Ctrl+number` switch.
- [ ] Status bar per tab: host label, connection state, model in use.

## Phase 2 — feature parity

- [ ] Slash command autocomplete in input.
- [ ] File attach / drag-and-drop.
- [ ] Session resume (pick a prior session for a project).
- [ ] Per-project overrides (model, effort, setting-sources).
- [ ] Markdown rendering for assistant output (code blocks, inline code, links).
- [ ] Syntax highlighting.
- [ ] Copy message / copy code button.
- [ ] Cost / token usage display per tab (parse from stream-json end-of-turn events).

## Phase 3 — nice-to-have

- [ ] Native SSH via `russh` (drop system-ssh dependency).
- [ ] Per-host daemon (optional) for lower spawn latency.
- [ ] Search across tabs.
- [ ] Export a session to markdown.
- [ ] Theme system.

## Open questions

- [ ] How does `claude` behave when spawned non-interactively with no TTY? Any features that silently degrade?
- [ ] Best way to detect permission requests in stream-json vs. regular tool uses? (`--permission-prompt-tool stdio` flag implications.)
- [ ] Do we need `--replay-user-messages` like the desktop app uses, or just feed user messages as stream-json events?
- [ ] How should "new chat" work — start a fresh `claude` process, or send a reset command to the existing one?
