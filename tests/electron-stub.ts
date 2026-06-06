// Test-only stub for the `electron` module, aliased in via vitest.config.ts.
//
// Unit and integration tests exercise main-process logic that transitively
// imports electron (e.g. acp-debug-log's `app.getPath`, session-manager via
// the providers graph). They must not depend on electron's downloaded binary
// — `require('electron')` outside the electron runtime throws "Electron
// failed to install correctly" when the postinstall didn't write path.txt,
// which is flaky across pnpm/CI. This stub provides the minimal surface those
// modules touch at load time. Production never sees this file (the app is
// bundled via electron.vite.config against the real module).
//
// Tests that need richer behaviour still override with their own
// vi.mock('electron', …) (e.g. ipc-handlers-boot), which takes precedence.

const noop = (): void => {}

export const app = {
  getPath: (): string => '/tmp/claude-launcher-test',
  getName: (): string => 'claude-launcher-test',
  getVersion: (): string => '0.0.0-test',
  on: noop,
  whenReady: (): Promise<void> => Promise.resolve(),
  isReady: (): boolean => true,
  quit: noop
}

export class BrowserWindow {
  webContents = { send: noop, on: noop, setWindowOpenHandler: noop }
  on = noop
  loadURL = noop
  loadFile = noop
  show = noop
  focus = noop
  static getAllWindows = (): BrowserWindow[] => []
  static fromWebContents = (): BrowserWindow | null => null
}

export const ipcMain = { handle: noop, on: noop, removeHandler: noop, removeAllListeners: noop }
export const ipcRenderer = { invoke: (): Promise<unknown> => Promise.resolve(), on: noop, send: noop }
export const contextBridge = { exposeInMainWorld: noop }
export const webFrame = { setZoomLevel: noop, getZoomLevel: (): number => 0 }
export const clipboard = { writeText: noop, readText: (): string => '' }
export const dialog = { showSaveDialog: (): Promise<{ canceled: boolean }> => Promise.resolve({ canceled: true }) }
export const shell = { openExternal: (): Promise<void> => Promise.resolve() }
export const session = { defaultSession: { setPermissionRequestHandler: noop } }
export class Menu {
  static buildFromTemplate = (): unknown => ({})
  static setApplicationMenu = noop
}
export class MenuItem {}

export default {
  app, BrowserWindow, ipcMain, ipcRenderer, contextBridge, webFrame,
  clipboard, dialog, shell, session, Menu, MenuItem
}
