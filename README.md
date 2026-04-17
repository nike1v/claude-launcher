# claude-launcher

A Windows desktop launcher for Claude Code sessions across multiple hosts — each project keeps its own account, MCP servers, plugins, and settings.

## Why

The official Claude Desktop for Windows can connect over SSH/WSL, but it **centralizes auth**: it injects its own `CLAUDE_CODE_OAUTH_TOKEN` into every spawned CLI (local, WSL, remote SSH), so every session runs under the account you're logged into in the desktop app — regardless of each host's own `claude login`.

Verified behavior on 2026-04-17:
- Desktop spawns `claude --output-format stream-json --input-format stream-json --setting-sources=user,project,local …`
- Env includes `CLAUDE_CODE_OAUTH_TOKEN=<desktop-account-token>` and `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1`
- Also sends `mcp_set_servers` and `hooks` via RPC, overriding host-side config
- `~/.claude/.credentials.json` on the host is ignored for auth

That breaks the use case: I want **per-host accounts** (Windows native = account A, WSL = account B, remote server = account C) with each host's own settings/MCP/plugins.

## Goal

A single Windows app with:
- A sidebar of pre-configured **projects** (`{name, host, path}`).
- Each project opens in a tab as a chat UI.
- The tab spawns `claude` on the target host in that path — with **no env-var overrides**, so the host's own credentials.json, settings.json, plugins, skills, hooks, and MCP servers are fully respected.
- Not tied to a terminal window.

## Architecture (MVP)

**Stack:** Tauri (Rust backend + webview, React/Svelte frontend). Small binary, native Windows, good subprocess + SSH support.

**Core model:**
```
Project { name, host, path, model?, effort? }
Host    = Local | WSL { distro } | SSH { user, host, port?, keyFile? }
```

**Transport per host:**
- Local Windows: spawn `claude.exe` directly.
- WSL: `wsl.exe -d <distro> --cd <path> -- claude --output-format stream-json --input-format stream-json …`.
- SSH: `ssh -T user@host 'cd <path> && claude …'` with stdin/stdout piped.

No daemon required on remote hosts for MVP — plain `ssh` + stream-json is enough.

**Rendering:** parse the stream-json event stream (same format Claude Desktop consumes) and render as a chat UI (user messages, assistant deltas, tool uses, tool results, slash command output, approval prompts).

**State:**
- Projects list persisted to `%APPDATA%/claude-launcher/projects.json`.
- Per-project session history optional (local cache).
- No auth state stored here — each host owns its own credentials.

## What we give up vs. the desktop app

- No OAuth login UI in the launcher — user runs `claude login` on each host themselves.
- No bundled CLI updates — each host manages its own `claude` install.
- No host-side hook/MCP override injection (that's the point).

## Evidence notes (for reference later)

- Desktop app bundles its CLI at `~/.claude/remote/ccd-cli/<version>` (~225 MB, byte-identical to the official `claude` binary).
- Desktop app runs a Go daemon at `~/.claude/remote/server` listening on `~/.claude/remote/rpc.sock`, spawned by the Windows client over SSH.
- Protocol: JSON-RPC with methods `server.ping`, `process.spawn`, `process.stdin`, `process.kill`; log at `~/.claude/remote/remote-server.log`.
- Env vars injected into spawned CLI: `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1`, `CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH=1`, `CLAUDE_INTERNAL_FC_OVERRIDES`, `CLAUDE_RPC_TOKEN`, `DISABLE_AUTOUPDATER`, `CLAUDE_CODE_DISABLE_CRON`, `CLAUDE_CODE_ENTRYPOINT=claude-desktop`.
- Confirmed via hash-comparison that env `CLAUDE_CODE_OAUTH_TOKEN` is a different token from `~/.claude/.credentials.json.claudeAiOauth.accessToken`.

## See also

- `TODO.md` — task list.
