# Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add seamless auto-update via `electron-updater` — silent check on startup, background download, banner when ready, and Help > Check for Updates for manual checks.

**Architecture:** `electron-updater` runs entirely in the main process (`src/main/updater.ts`). It emits `updater:status` IPC events to the renderer. The renderer shows a dismissable `UpdateBanner` when `state === 'ready'`. The existing default Electron Help menu is patched to add "Check for Updates".

**Tech Stack:** `electron-updater`, Electron `Menu` API, React, Tailwind CSS, Vitest + React Testing Library

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `package.json` | Modify | Add `electron-updater` to `dependencies` |
| `src/shared/types.ts` | Modify | Add `UpdaterStatus` type + updater IPC channels |
| `src/main/updater.ts` | Create | All auto-update logic, IPC handlers, Help menu patch |
| `src/main/index.ts` | Modify | Call `initAutoUpdater(win)` after window is ready |
| `src/renderer/src/ipc/bridge.ts` | Modify | Add `installUpdate()` helper |
| `src/renderer/src/components/UpdateBanner.tsx` | Create | Banner shown when update is ready |
| `src/renderer/src/components/UpdateBanner.test.tsx` | Create | Tests for banner visibility and interactions |
| `src/renderer/src/App.tsx` | Modify | Mount `<UpdateBanner />` above tab bar |

---

### Task 1: Install electron-updater

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

```bash
pnpm add electron-updater
```

- [ ] **Step 2: Verify it's in dependencies**

```bash
grep electron-updater package.json
```

Expected output includes: `"electron-updater": "^..."`

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add electron-updater dependency"
```

---

### Task 2: Add updater IPC types

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `UpdaterStatus` type and updater channels**

In `src/shared/types.ts`, after the `IpcChannels` interface opening and before the existing `session:start` entry, add the `UpdaterStatus` export. Then add the updater channels to `IpcChannels`, and extend `IpcInvokeChannel` and `IpcEventChannel`.

Replace the bottom of `src/shared/types.ts` (from `// ── IPC channel contracts` onwards) with:

```ts
// ── Updater ──────────────────────────────────────────────────────────────────

export interface UpdaterStatus {
  state: 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error'
  version?: string
  percent?: number
  message?: string
}

// ── IPC channel contracts ────────────────────────────────────────────────────

export interface IpcChannels {
  // Renderer → Main (invoke)
  'session:start': { projectId: string; resumeSessionId?: string }
  'session:send': { sessionId: string; text: string }
  'session:stop': { sessionId: string }
  'session:permission': { sessionId: string; decision: 'allow' | 'deny'; toolUseId: string }
  'projects:save': Project[]
  'projects:history:load': { projectId: string }
  'projects:load': Record<string, never>
  'updater:check': Record<string, never>
  'updater:install': Record<string, never>

  // Main → Renderer (events)
  'session:event': { sessionId: string; event: StreamJsonEvent }
  'session:status': { sessionId: string; status: Session['status']; errorMessage?: string }
  'projects:history': { projectId: string; entries: HistoryEntry[] }
  'projects:loaded': { projects: Project[] }
  'updater:status': UpdaterStatus
}

export type IpcInvokeChannel = Extract<
  keyof IpcChannels,
  | 'session:start' | 'session:send' | 'session:stop' | 'session:permission'
  | 'projects:save' | 'projects:history:load' | 'projects:load'
  | 'updater:check' | 'updater:install'
>

export type IpcEventChannel = Extract<
  keyof IpcChannels,
  'session:event' | 'session:status' | 'projects:history' | 'projects:loaded' | 'updater:status'
>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add updater IPC channel types"
```

---

### Task 3: Create src/main/updater.ts

**Files:**
- Create: `src/main/updater.ts`

- [ ] **Step 1: Create the file**

```ts
import { ipcMain, BrowserWindow, Menu, dialog, app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdaterStatus } from '../shared/types'

function send(win: BrowserWindow, status: UpdaterStatus): void {
  if (!win.isDestroyed()) win.webContents.send('updater:status', status)
}

function patchHelpMenu(checkFn: () => void): void {
  const menu = Menu.getApplicationMenu()
  if (!menu) return
  const helpMenu = menu.items.find(item => item.label === 'Help')
  if (!helpMenu?.submenu) return
  helpMenu.submenu.append(new (require('electron').MenuItem)({ type: 'separator' }))
  helpMenu.submenu.append(new (require('electron').MenuItem)({
    label: 'Check for Updates',
    click: checkFn
  }))
  Menu.setApplicationMenu(menu)
}

export function initAutoUpdater(win: BrowserWindow): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  let isManualCheck = false

  autoUpdater.on('checking-for-update', () => {
    send(win, { state: 'checking' })
  })

  autoUpdater.on('update-available', info => {
    send(win, { state: 'available', version: info.version })
  })

  autoUpdater.on('download-progress', progress => {
    send(win, { state: 'downloading', percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', info => {
    send(win, { state: 'ready', version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    send(win, { state: 'up-to-date' })
    if (isManualCheck) {
      dialog.showMessageBox(win, {
        type: 'info',
        title: 'No Updates',
        message: 'You are already on the latest version.'
      })
      isManualCheck = false
    }
  })

  autoUpdater.on('error', err => {
    send(win, { state: 'error', message: err.message })
    if (isManualCheck) {
      dialog.showMessageBox(win, {
        type: 'error',
        title: 'Update Error',
        message: `Could not check for updates: ${err.message}`
      })
      isManualCheck = false
    }
  })

  const checkForUpdates = (): void => {
    isManualCheck = true
    autoUpdater.checkForUpdates()
  }

  patchHelpMenu(checkForUpdates)

  ipcMain.handle('updater:check', () => {
    isManualCheck = true
    autoUpdater.checkForUpdates()
  })

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall()
  })

  // Silent startup check
  autoUpdater.checkForUpdates().catch(() => {})
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/main/updater.ts
git commit -m "feat: add auto-updater main process logic"
```

---

### Task 4: Wire initAutoUpdater into src/main/index.ts

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add the import and call**

Replace the contents of `src/main/index.ts` with:

```ts
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc-handlers'
import { initAutoUpdater } from './updater'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0d0d0d',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  return win
}

app.whenReady().then(() => {
  const win = createWindow()
  const cleanup = registerIpcHandlers(win)
  initAutoUpdater(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('before-quit', cleanup)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: wire initAutoUpdater into app startup"
```

---

### Task 5: Add installUpdate to bridge.ts

**Files:**
- Modify: `src/renderer/src/ipc/bridge.ts`

- [ ] **Step 1: Add the helper at the end of the file**

Append to `src/renderer/src/ipc/bridge.ts`:

```ts
export function installUpdate(): void {
  window.electronAPI.invoke('updater:install', {})
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/ipc/bridge.ts
git commit -m "feat: add installUpdate IPC bridge helper"
```

---

### Task 6: Create UpdateBanner component and tests

**Files:**
- Create: `src/renderer/src/components/UpdateBanner.tsx`
- Create: `src/renderer/src/components/UpdateBanner.test.tsx`

- [ ] **Step 1: Write the failing tests first**

Create `src/renderer/src/components/UpdateBanner.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { UpdateBanner } from './UpdateBanner'
import type { UpdaterStatus } from '../../../../shared/types'

const mockOn = vi.fn()
const mockInstall = vi.fn()

vi.mock('../ipc/bridge', () => ({ installUpdate: mockInstall }))

beforeEach(() => {
  vi.clearAllMocks()
  mockOn.mockReturnValue(vi.fn())
  vi.stubGlobal('electronAPI', { on: mockOn, invoke: vi.fn() })
})

function getStatusHandler(): (status: UpdaterStatus) => void {
  const call = mockOn.mock.calls.find(([ch]: [string]) => ch === 'updater:status')
  return call?.[1]
}

describe('UpdateBanner', () => {
  it('renders nothing by default', () => {
    const { container } = render(<UpdateBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when state is not ready', () => {
    const { container } = render(<UpdateBanner />)
    act(() => { getStatusHandler()({ state: 'downloading', percent: 50 }) })
    expect(container.firstChild).toBeNull()
  })

  it('shows banner with version when state is ready', () => {
    render(<UpdateBanner />)
    act(() => { getStatusHandler()({ state: 'ready', version: '1.2.3' }) })
    expect(screen.getByText(/1\.2\.3/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /restart/i })).toBeTruthy()
  })

  it('calls installUpdate when Restart & Update is clicked', () => {
    render(<UpdateBanner />)
    act(() => { getStatusHandler()({ state: 'ready', version: '1.2.3' }) })
    fireEvent.click(screen.getByRole('button', { name: /restart/i }))
    expect(mockInstall).toHaveBeenCalledOnce()
  })

  it('dismisses the banner when × is clicked', () => {
    const { container } = render(<UpdateBanner />)
    act(() => { getStatusHandler()({ state: 'ready', version: '1.2.3' }) })
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test -- UpdateBanner
```

Expected: FAIL — `UpdateBanner` not found

- [ ] **Step 3: Create the component**

Create `src/renderer/src/components/UpdateBanner.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { installUpdate } from '../ipc/bridge'
import type { UpdaterStatus } from '../../../../shared/types'

export function UpdateBanner(): JSX.Element | null {
  const [status, setStatus] = useState<UpdaterStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    return window.electronAPI.on('updater:status', setStatus)
  }, [])

  if (!status || status.state !== 'ready' || dismissed) return null

  return (
    <div className="flex items-center justify-between px-4 py-1.5 bg-blue-600/90 text-white text-sm">
      <span>
        Version {status.version} is ready to install
      </span>
      <div className="flex items-center gap-3">
        <button
          onClick={installUpdate}
          className="font-medium underline hover:no-underline"
        >
          Restart &amp; Update
        </button>
        <button
          onClick={() => setDismissed(true)}
          aria-label="dismiss"
          className="hover:opacity-70"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm test -- UpdateBanner
```

Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/UpdateBanner.tsx src/renderer/src/components/UpdateBanner.test.tsx
git commit -m "feat: add UpdateBanner component with tests"
```

---

### Task 7: Mount UpdateBanner in App.tsx

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add import and mount the banner**

Replace `src/renderer/src/App.tsx` with:

```tsx
import { useEffect } from 'react'
import { useSessionsStore } from './store/sessions'
import { useIpcListeners } from './ipc/listeners'
import { Sidebar } from './components/Sidebar/Sidebar'
import { TabBar } from './components/TabBar/TabBar'
import { ChatPanel } from './components/Chat/ChatPanel'
import { StatusBar } from './components/StatusBar/StatusBar'
import { UpdateBanner } from './components/UpdateBanner'

export function App(): JSX.Element {
  useIpcListeners()

  const { sessions, tabOrder, activeSessionId } = useSessionsStore()

  useEffect(() => {
    window.electronAPI.invoke('projects:load', {})
  }, [])

  return (
    <div className="flex h-screen bg-[#0d0d0d] text-[#e5e5e5] overflow-hidden">
      {/* Sidebar */}
      <div className="w-56 shrink-0 border-r border-white/10 flex flex-col">
        <Sidebar />
      </div>

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0">
        <UpdateBanner />
        <TabBar />
        <div className="flex-1 overflow-hidden">
          {tabOrder.map(sessionId => (
            <div
              key={sessionId}
              className={activeSessionId === sessionId ? 'h-full' : 'hidden'}
            >
              <ChatPanel sessionId={sessionId} />
            </div>
          ))}
          {tabOrder.length === 0 && (
            <div className="h-full flex items-center justify-center text-white/30 text-sm">
              Select a project from the sidebar to start a session
            </div>
          )}
        </div>
        <StatusBar />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run all tests**

```bash
pnpm test
```

Expected: all tests PASS

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: mount UpdateBanner in app layout"
```

---

### Task 8: Build and tag release

- [ ] **Step 1: Build the Windows installer**

```bash
pnpm dist:win
```

Expected: `dist/` contains `.exe` installer and `latest.yml`

- [ ] **Step 2: Commit any generated artifacts if needed, then tag the next version**

```bash
# Check current latest tag first
git describe --tags --abbrev=0

# Tag the next patch version (e.g. if current is v0.1.12, use v0.1.13)
git tag v0.1.X
git push origin main
git push origin v0.1.X
```

> Note: Create a GitHub Release from the tag and upload the `.exe` + `latest.yml` files from `dist/`. `electron-updater` reads `latest.yml` to determine the current release version and download URL. Without `latest.yml` on the release, auto-update will not work.
