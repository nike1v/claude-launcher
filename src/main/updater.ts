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
