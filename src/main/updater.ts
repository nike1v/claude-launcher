import { ipcMain, BrowserWindow, Menu, MenuItem, app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdaterStatus } from '../shared/types'

function send(win: BrowserWindow, status: UpdaterStatus): void {
  if (win.isDestroyed()) return
  win.webContents.send('updater:status', { currentVersion: app.getVersion(), ...status })
}

function patchHelpMenu(checkFn: () => void): void {
  const menu = Menu.getApplicationMenu()
  if (!menu) return
  const helpMenu = menu.items.find(item => item.label === 'Help')
  if (!helpMenu?.submenu) return
  helpMenu.submenu.append(new MenuItem({ type: 'separator' }))
  helpMenu.submenu.append(new MenuItem({ label: 'Check for Updates', click: checkFn }))
  Menu.setApplicationMenu(menu)
}

export function initAutoUpdater(win: BrowserWindow): void {
  if (!app.isPackaged) {
    // In dev there's nothing to download, but make Help → Check feel responsive
    // by emitting a quick checking → up-to-date sequence so the pill flashes.
    ipcMain.handle('updater:check', () => {
      send(win, { state: 'checking' })
      setTimeout(() => send(win, { state: 'up-to-date' }), 400)
    })
    ipcMain.handle('updater:install', () => {})
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

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
  })

  autoUpdater.on('error', err => {
    // A release tag can exist on GitHub before CI finishes uploading the
    // platform yml/installer assets. electron-updater surfaces that as a 404
    // on latest-*.yml — treat it as "no update yet" rather than an error.
    if (isMissingReleaseAssetError(err)) {
      send(win, { state: 'up-to-date' })
      return
    }
    send(win, { state: 'error', message: err.message })
  })

  const checkForUpdates = (): void => {
    autoUpdater.checkForUpdates().catch(() => {})
  }

  patchHelpMenu(checkForUpdates)

  ipcMain.handle('updater:check', () => {
    autoUpdater.checkForUpdates().catch(() => {})
  })

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall()
  })

  // Silent startup check — the renderer's pill is hidden until the first
  // status event arrives, so we let `checking-for-update` be that trigger.
  autoUpdater.checkForUpdates().catch(() => {})
}

function isMissingReleaseAssetError(err: Error): boolean {
  const msg = err.message ?? ''
  return /404|cannot find .*\.yml|cannot parse update info from .*\.yml/i.test(msg)
}
