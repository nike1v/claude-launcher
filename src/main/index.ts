import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc-handlers'
import { initAutoUpdater } from './updater'
import { initProviders } from './providers/init'

// Only http(s) gets handed to the OS browser. file://, javascript:, data:,
// and unknown schemes from a compromised renderer would otherwise call
// shell.openExternal() with attacker-controlled input.
function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

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
      nodeIntegration: false,
      sandbox: true
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Prevent the renderer from being navigated away from our bundled UI. The
  // only legitimate origins are the dev server (set via ELECTRON_RENDERER_URL)
  // and our packaged file:// path.
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env['ELECTRON_RENDERER_URL']
    if (allowed && url.startsWith(allowed)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) shell.openExternal(url)
  })

  // Linux / Windows: there's no application menu by default, so the OS
  // never sees an accelerator for Ctrl+Q. macOS gets Cmd+Q from
  // electron's auto-built menu so we skip there.
  if (process.platform !== 'darwin') {
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return
      const ctrlOrMeta = input.control || input.meta
      if (ctrlOrMeta && !input.alt && !input.shift && input.key.toLowerCase() === 'q') {
        app.quit()
      }
    })
  }

  return win
}

app.whenReady().then(() => {
  // Deny every renderer permission request by default. We don't ask for
  // camera, mic, geolocation, notifications, etc., so a compromised renderer
  // shouldn't be able to opt itself in.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

  // Register IProvider + IProviderAdapter implementations before any IPC
  // handler runs. session-manager looks up providers from the registry on
  // session start; an unregistered kind throws.
  initProviders()

  const win = createWindow()
  const cleanup = registerIpcHandlers(win)
  initAutoUpdater(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  let isQuitting = false
  app.on('before-quit', (event) => {
    if (isQuitting) return
    isQuitting = true
    event.preventDefault()
    cleanup().finally(() => app.exit(0))
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
