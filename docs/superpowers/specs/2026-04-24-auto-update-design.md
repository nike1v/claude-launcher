# Auto-Update Design

**Date:** 2026-04-24  
**Scope:** Windows (NSIS) primary; Linux excluded for now

## Overview

Add seamless auto-update to Claude Launcher using `electron-updater` backed by GitHub Releases. The app checks for updates silently on startup, downloads in the background, and shows a dismissable banner when ready to install. A manual "Check for Updates" item is added to the existing Help menu.

## Architecture

All update logic lives in the main process (`src/main/updater.ts`). The renderer is a passive consumer — it receives status events over IPC and renders UI accordingly. No update logic in the renderer.

### Main process — `src/main/updater.ts`

- Exports `initAutoUpdater(win: BrowserWindow)` called from `index.ts` after the window is ready
- Configures `autoUpdater` with `autoDownload: true`, `autoInstallOnAppQuit: false`
- Triggers a silent `checkForUpdates()` on startup (no dialog if already up to date)
- Patches the default Electron Help menu: appends a separator + "Check for Updates" menu item that calls `checkForUpdates()`
- Registers two IPC handlers:
  - `updater:check` — triggers `checkForUpdates()` (renderer-initiated manual check)
  - `updater:install` — calls `autoUpdater.quitAndInstall()`
- Emits `updater:status` to the renderer window with shape:
  ```ts
  { state: 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error', version?: string, percent?: number, message?: string }
  ```

### `src/main/index.ts`

One addition: `initAutoUpdater(win)` called inside `app.whenReady()` after `createWindow()`.

### Renderer — `src/renderer/src/components/UpdateBanner.tsx`

- Subscribes to `updater:status` via `window.electron.ipcRenderer.on`
- Renders nothing unless `state === 'ready'`
- When visible: thin bar above the tab bar. Content: `"Version X.X.X is ready"` + `[Restart & Update]` button + `[×]` dismiss button
- "Restart & Update" calls `installUpdate()` from the IPC bridge
- Dismissing hides the banner for the session (does not cancel the update)

### `src/renderer/src/App.tsx`

Mount `<UpdateBanner />` above the existing layout root.

### `src/renderer/src/ipc/bridge.ts`

Add two helpers:
- `checkForUpdates()` — invokes `updater:check`
- `installUpdate()` — invokes `updater:install`

## Data Flow

### Startup
```
app ready → initAutoUpdater(win) → checkForUpdates() [silent]
  → update found: download starts → updater:status {downloading} → updater:status {ready}
  → no update: updater:status {up-to-date} [banner stays hidden]
```

### Manual check (Help menu)
```
User clicks Help > Check for Updates
  → checkForUpdates() → updater:status {checking}
  → result: {available} / {up-to-date} / {error}
  → if available: download starts → {downloading} → {ready}
```

### Install
```
User clicks "Restart & Update" in banner
  → installUpdate() IPC → autoUpdater.quitAndInstall()
  → app restarts, NSIS installer applies silently
```

## Error Handling

- Network failures and GitHub API errors are caught in `autoUpdater` event handlers
- Sent to renderer as `{ state: 'error', message }` 
- On startup check: errors are suppressed silently (no dialog)
- On manual check via Help menu: a native `dialog.showMessageBox` shows the error or "Already up to date" message
- No crash, no modal

## Dependencies

- `electron-updater` added to `dependencies` in `package.json`
- GitHub repository already configured: `"publish": { "provider": "github" }` in `package.json`
- GitHub release must include the `latest.yml` artifact (electron-builder generates this automatically with `dist` script)

## What's Not In Scope

- Linux auto-update (AppImage requires separate mechanism)
- macOS auto-update
- Update progress bar in the banner (percent available but not shown — keep it simple)
- Rollback / version pinning
