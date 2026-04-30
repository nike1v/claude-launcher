import { ipcMain, BrowserWindow, Menu, MenuItem, app } from 'electron'
// electron-updater is CJS — Node's ESM loader can't pull `autoUpdater` as a
// named export, so default-import the whole module and destructure manually.
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater
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
  // Channel follows the installed version's SemVer tag. A user running
  // 0.4.38 (no `-` in the version) stays on the stable feed and never
  // auto-flips to a prerelease. A user who explicitly installed
  // 0.5.0-alpha.N keeps getting successive alphas / betas / rcs until
  // 0.5.0 stable ships, at which point semver ordering pulls them onto
  // the stable build (0.5.0-rc.1 < 0.5.0). This matches electron-
  // updater's own default heuristic.
  autoUpdater.allowPrerelease = app.getVersion().includes('-')

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

  const reportCheckError = (err: unknown): void => {
    if (err instanceof Error && isMissingReleaseAssetError(err)) {
      send(win, { state: 'up-to-date' })
      return
    }
    const message = err instanceof Error ? err.message : 'Update check failed'
    console.error('[updater] checkForUpdates rejected:', err)
    send(win, { state: 'error', message })
  }

  const checkForUpdates = (): void => {
    forceFreshCheck()
    autoUpdater.checkForUpdates().catch(reportCheckError)
  }

  patchHelpMenu(checkForUpdates)

  ipcMain.handle('updater:check', () => {
    forceFreshCheck()
    autoUpdater.checkForUpdates().catch(reportCheckError)
  })

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall()
  })

  // Silent startup check — surface failures the same way as a manual check
  // so a broken release feed doesn't sit invisible until the user clicks
  // "Check for updates".
  autoUpdater.checkForUpdates().catch(reportCheckError)
}

function isMissingReleaseAssetError(err: Error): boolean {
  const msg = err.message ?? ''
  return /404|cannot find .*\.yml|cannot parse update info from .*\.yml/i.test(msg)
}

// electron-updater memoises the provider client and the last update-info
// result inside AppUpdater. After the silent startup check, a manual
// re-check can short-circuit on that cached state instead of re-fetching
// the GitHub feed — which is why a freshly released version doesn't
// appear until the app is relaunched. Null both fields before each
// manual call so the next check truly hits the network.
function forceFreshCheck(): void {
  const internal = autoUpdater as unknown as {
    clientPromise?: Promise<unknown> | null
    updateInfoAndProvider?: unknown | null
  }
  internal.clientPromise = null
  internal.updateInfoAndProvider = null
}
