import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Smoke test that runs *all* of registerIpcHandlers' construction code in
// one go: stores instantiated, migration executed, SessionManager built,
// every ipcMain.handle() registered. The v0.4.1 → v0.4.2 regression was a
// TDZ inside a SessionManager parameter property default — the bundle
// loaded fine, the class file loaded fine, but the *first* call to
// `new SessionManager(undefined, safeSend)` (from inside this very
// function) crashed and the renderer never got an answer to
// `projects:load`. A test that exercises that exact path would have
// caught it.
//
// We mock electron with a stub `ipcMain` that just records channel names
// so we can assert the expected surface registered. BrowserWindow is a
// dummy with isDestroyed/webContents stubs — registerIpcHandlers builds
// safeSend off it but doesn't fire safeSend until events flow.

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn()
  },
  dialog: {
    showSaveDialog: vi.fn()
  },
  BrowserWindow: class {}
}))

import { ipcMain } from 'electron'
import { registerIpcHandlers } from '../../src/main/ipc-handlers'

const fakeWindow = {
  isDestroyed: () => false,
  webContents: {
    isDestroyed: () => false,
    send: vi.fn()
  }
} as unknown as Electron.BrowserWindow

describe('registerIpcHandlers boot smoke', () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear()
    vi.mocked(ipcMain.removeHandler).mockClear()
  })
  afterEach(async () => {
    // The handler installs a teardown — exercising it shakes out any
    // dangling-process / handler-removal bugs at the same time.
    // Note: registerIpcHandlers returns the teardown; we call it inside
    // each test below.
  })

  it('boots without throwing — catches TDZ / import-time crashes', () => {
    expect(() => registerIpcHandlers(fakeWindow)).not.toThrow()
  })

  it('registers every IPC channel the renderer relies on', () => {
    registerIpcHandlers(fakeWindow)
    const registered = vi.mocked(ipcMain.handle).mock.calls.map(c => c[0])
    // Must include all renderer-side invoke channels — if one is missing
    // the renderer will hang forever waiting for a response.
    const required = [
      'session:start', 'session:send', 'session:stop',
      'session:interrupt', 'session:permission',
      'projects:save', 'projects:load',
      'session:history:load',
      'environments:save', 'environments:load',
      'environments:probe', 'environments:usage',
      'fs:listDir',
      'tabs:load', 'tabs:save',
      'dialog:saveFile'
    ]
    for (const channel of required) {
      expect(registered, `missing handler for ${channel}`).toContain(channel)
    }
  })

  it('returns a teardown function that removes every channel', async () => {
    const teardown = registerIpcHandlers(fakeWindow)
    await teardown()
    const removed = vi.mocked(ipcMain.removeHandler).mock.calls.map(c => c[0])
    // No registered channel should be left after teardown.
    const registered = vi.mocked(ipcMain.handle).mock.calls.map(c => c[0])
    for (const channel of registered) {
      expect(removed, `teardown didn't remove ${channel}`).toContain(channel)
    }
  })
})
