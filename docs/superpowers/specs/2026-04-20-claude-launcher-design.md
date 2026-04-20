# claude-launcher — Design Spec

**Date:** 2026-04-20  
**Status:** Approved  
**Author:** Nikita Vlasov (reviewed and approved)

---

## Problem Statement

The official Claude Code Desktop app supports SSH and WSL connections but injects its own
`CLAUDE_CODE_OAUTH_TOKEN` and MCP/hook config into every spawned CLI session — local, WSL, and
remote SSH alike. This makes it impossible to use per-host accounts, MCPs, skills, hooks, or
plugins. Every session runs under the desktop app's identity.

**Verified env vars injected by the desktop app:**
- `CLAUDE_CODE_OAUTH_TOKEN` — overrides host credentials
- `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1`
- `CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH=1`
- `CLAUDE_INTERNAL_FC_OVERRIDES` — overrides MCP/hooks
- `CLAUDE_RPC_TOKEN`, `CLAUDE_CODE_DISABLE_CRON`, `CLAUDE_CODE_ENTRYPOINT=claude-desktop`

**Goal:** a single app where each project tab spawns `claude` on its target host with zero env-var
overrides, so the host's own `~/.claude/credentials.json`, `settings.json`, skills, hooks, plugins,
and MCP servers are fully respected.

---

## Scope

**In scope (MVP):**
- WSL and SSH host types
- Full chat UI backed by stream-json (not a terminal wrapper)
- Per-project session history via host filesystem
- Persistent tabs — subprocesses stay alive while switching between tabs
- Project management (add / edit / delete)

**Out of scope (MVP):**
- Local Windows native host (not needed by the author)
- OAuth login UI — users run `claude login` on each host themselves
- CLI auto-update — each host manages its own `claude` install
- File attach / drag-and-drop
- Slash command autocomplete

---

## Stack Decision

| Layer | Choice | Rationale |
|---|---|---|
| Desktop shell | **Electron** | All TypeScript — better for AI-agent maintenance than Tauri (Rust) |
| UI framework | **React 19 + Vite** | Standard, well-understood by AI agents |
| Routing | **TanStack Router** | File-based, type-safe |
| State | **Zustand** | Simple, conventional — Effect rejected as too abstract for AI maintenance |
| Editor input | **Lexical** | Rich text, multiline, extensible (borrowed from T3 Code) |
| Styling | **Tailwind v4** | |
| IPC | **Electron contextBridge** | Typed, secure — renderer never gets direct Node.js access |
| Package manager | **Bun** | Monorepo, fast |
| Build | **electron-vite** | Vite for renderer, esbuild for main |

**T3 Code relationship:** UI patterns and components are borrowed (xterm.js wiring, Lexical setup,
layout tokens, Tailwind config). Backend/orchestration is entirely new — T3 Code uses the Claude
Agent SDK talking directly to the API; we spawn the `claude` CLI binary on each host.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Electron Main Process (Node.js)                    │
│                                                     │
│  ┌──────────────┐   ┌───────────────────────────┐  │
│  │ Project Store│   │ Session Manager           │  │
│  │ (JSON file)  │   │ - spawn/kill subprocesses │  │
│  └──────────────┘   │ - parse stream-json       │  │
│                     │ - forward events via IPC  │  │
│                     └───────────────────────────┘  │
│                              │                      │
│              ┌───────────────┼───────────────┐      │
│           WSL distro      SSH -T           (future) │
│        wsl.exe ...       ssh user@host              │
└──────────────────────────────┼──────────────────────┘
                    Typed IPC (contextBridge)
┌─────────────────────────────────────────────────────┐
│  Electron Renderer Process (React)                  │
│                                                     │
│  Sidebar │ Tab Bar │ Chat Panel │ Status Bar        │
│  Zustand store + IPC event listeners                │
└─────────────────────────────────────────────────────┘
```

**No separate server process.** Main process owns all subprocess lifecycle. No HTTP layer.
The Electron shell directly manages spawned `claude` processes and pipes events to the renderer.

---

## Core Data Model

```typescript
type HostType =
  | { kind: "wsl"; distro: string }
  | { kind: "ssh"; user: string; host: string; port?: number; keyFile?: string }

interface Project {
  id: string        // uuid
  name: string
  host: HostType
  path: string      // absolute path on the target host
  model?: string    // optional --model flag override
}

interface Session {
  id: string
  projectId: string
  status: "starting" | "ready" | "busy" | "error" | "closed"
  pid?: number      // subprocess PID for kill/signal
  hasUnread: boolean // activity while tab was not active
}

interface HistoryEntry {
  sessionId: string  // matches ~/.claude/projects/<hash>/<sessionId>
  createdAt: string
  summary?: string   // first assistant message truncated
}
```

**Persistence:**
- `projects.json` → `~/.config/claude-launcher/projects.json`
- Session history → read from host filesystem on demand (`~/.claude/projects/<hash>/`)
  where `<hash>` is the SHA-256 of the absolute project path (Claude's own convention)
- Runtime session state → Zustand in-memory only, not persisted

---

## Transport Layer

Each host type spawns `claude` identically — only the shell wrapper differs. **No env overrides.**

**WSL:**
```
wsl.exe -d <distro> --cd <path> -- claude \
  --output-format stream-json \
  --input-format stream-json \
  --permission-prompt-tool stdio
```

**SSH:**
```
ssh -T [-p <port>] [-i <keyFile>] <user>@<host> \
  'cd <path> && claude \
    --output-format stream-json \
    --input-format stream-json \
    --permission-prompt-tool stdio'
```

**Session resume:**
```
... claude --resume <sessionId> --output-format stream-json ...
```

### Stream-json Event Handling

| Event type | Renderer action |
|---|---|
| `assistant` delta | Append to streaming message bubble |
| `user` | Render sent message |
| `tool_use` | Render collapsible tool call panel (collapsed by default) |
| `tool_result` | Attach result inside tool panel |
| `system` / `permission_request` | Render inline Approve / Deny buttons |
| `result` (end of turn) | Show cost + token count in status bar |
| `error` | Set tab to error state |

Malformed stream-json lines are silently skipped — the subprocess continues running.

---

## Session Lifecycle

```
starting → ready ↔ busy → closed
                ↑
   (background: subprocess running,
    events buffering in Zustand
    while user is on another tab)
```

**Key rule:** switching tabs never kills or suspends a subprocess. A session only closes when:
1. The user clicks the × on the tab, or
2. The app quits

All active subprocesses run simultaneously. Message buffers accumulate in Zustand per session.
A recommended soft cap of ~10 simultaneous sessions should be documented for public release.

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [≡]  claude-launcher                          [─][□][×]    │
├──────────────┬──────────────────────────────────────────────┤
│              │  [WSL/work] api-server ●  [SSH/hetz] blog ×  │
│  PROJECTS    ├──────────────────────────────────────────────┤
│              │                                              │
│  ▼ WSL       │  ┌─────────────────────────────────────┐    │
│    api-server│  │ assistant                            │    │
│    auth-srv  │  │  Here's the updated migration...     │    │
│    frontend  │  └─────────────────────────────────────┘    │
│              │  ┌─────────────────────────────────────┐    │
│  ▼ Hetzner   │  │ ▶ tool: Edit file.ts                │    │
│    blog      │  └─────────────────────────────────────┘    │
│    scripts   │  ┌─────────────────────────────────────┐    │
│              │  │ assistant                            │    │
│  + Add       │  │  Done. Want me to run the tests?     │    │
│              │  └─────────────────────────────────────┘    │
│  ── History ─│                                              │
│  today       │  ┌── permission ──────────────────────────┐ │
│  yesterday   │  │ Run: npm test          [Allow] [Deny]  │ │
│              │  └────────────────────────────────────────┘ │
│              ├──────────────────────────────────────────────┤
│              │  [Lexical input ..................] [Send]    │
├──────────────┴──────────────────────────────────────────────┘
│  WSL · Ubuntu · ~/aida-v2-backend    claude-sonnet-4-5  ●  │
└─────────────────────────────────────────────────────────────┘
```

**Sidebar:**
- Projects grouped by host, chevron-collapsible
- Click project → open new tab (new session)
- History section below shows past sessions for the active project — click to resume

**Tab bar:**
- One tab per open session, multiple tabs for same project allowed
- `●` dot on tab = unread activity while tab was inactive — cleared on visit
- `Ctrl+T` new tab (same project), `Ctrl+W` close, `Ctrl+1–9` switch

**Chat panel:**
- Streams in real time
- Tool uses collapsed by default, click to expand
- Permission prompts inline as buttons — never modal dialogs
- Each tab independently remembers scroll position
- Switching back lands where you left off, not force-scrolled to bottom

**Input:**
- Lexical editor — multiline, `Enter` sends, `Shift+Enter` newline

**Status bar:**
- Host label · distro/hostname · active path · model · connection state dot

---

## IPC Channels

All channels are typed via `contextBridge`. Renderer never accesses Node.js directly.

| Direction | Channel | Payload |
|---|---|---|
| Renderer → Main | `session:start` | `{ projectId, resumeSessionId? }` |
| Renderer → Main | `session:send` | `{ sessionId, text }` |
| Renderer → Main | `session:stop` | `{ sessionId }` |
| Renderer → Main | `session:permission` | `{ sessionId, decision: "allow" \| "deny" }` |
| Renderer → Main | `projects:save` | `Project[]` |
| Renderer → Main | `projects:history:load` | `{ projectId }` |
| Main → Renderer | `session:event` | `{ sessionId, event: StreamJsonEvent }` |
| Main → Renderer | `session:status` | `{ sessionId, status: Session["status"] }` |
| Main → Renderer | `projects:history` | `{ projectId, entries: HistoryEntry[] }` |

---

## Error Handling

Errors are scoped to the tab that owns the subprocess — they never crash the app.

| Scenario | Behavior |
|---|---|
| `claude` not found on host | Tab error: "claude not installed" with install docs link |
| SSH connection refused / timeout | Tab error: "Connection failed" with retry button |
| SSH key permission denied | Tab error: specific message with key setup guidance |
| WSL distro not found | Tab error on session start |
| Subprocess exits unexpectedly | Tab error state, shows exit code, offers restart button |
| Stream-json parse error | Log silently, skip malformed line, continue |

---

## Testing Strategy

- **Unit tests:** stream-json parser (event shapes → typed objects), project config
  serialization/deserialization, IPC message schema validation
- **Integration tests:** spawn a mock `claude` script that outputs pre-recorded stream-json
  fixtures, assert renderer receives correct typed events in correct order
- **No E2E in CI:** SSH and WSL are not available in CI environments. Real-host testing
  is manual using a dedicated test project config pointing at a safe directory.

---

## Phased Rollout

**Phase 1 — MVP (this spec)**
Scaffold, project management, WSL + SSH transport, stream-json chat UI, session history,
persistent tabs, permission prompts, status bar, keyboard shortcuts.

**Phase 2 — Polish**
Slash command autocomplete, file attach, per-project model/effort overrides, session export
to markdown, cost/token display, syntax highlighting in code blocks.

**Phase 3 — Public release prep**
Auto-update, installer (NSIS/Squirrel), session search, theme system, onboarding flow,
soft cap warnings for simultaneous sessions.
