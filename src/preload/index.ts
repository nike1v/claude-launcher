import { clipboard, contextBridge, ipcRenderer, webFrame } from 'electron'
import type { ElectronApi, IpcChannels, IpcEventChannel } from '../shared/types'

const api: ElectronApi = {
  platform: process.platform as NodeJS.Platform,

  invoke: <K extends keyof IpcChannels>(
    channel: K,
    payload: IpcChannels[K]
  ): Promise<unknown> => ipcRenderer.invoke(channel as string, payload),

  on: <K extends IpcEventChannel>(
    channel: K,
    handler: (payload: IpcChannels[K]) => void
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: IpcChannels[K]) =>
      handler(payload)
    ipcRenderer.on(channel as string, listener)
    return () => ipcRenderer.removeListener(channel as string, listener)
  },

  // Zoom controls via webFrame (lives in the renderer, but contextIsolation
  // + sandbox keeps the renderer itself away from electron APIs — preload
  // is the only place we can call it). Levels follow Chromium convention:
  // 0 = 100 %, +1 ≈ 120 %, -1 ≈ 83 %, etc.
  getZoomLevel: () => webFrame.getZoomLevel(),
  setZoomLevel: (level: number) => webFrame.setZoomLevel(level),

  // Native clipboard write. Routes through electron's clipboard module
  // instead of `navigator.clipboard.writeText` because the latter goes
  // through Chromium's permission API, which our `setPermissionRequestHandler`
  // (deny-all by default since v0.4.4 hardening) refuses for the
  // `clipboard-sanitized-write` permission. Using electron.clipboard
  // bypasses that gate — the renderer can't reach electron directly under
  // contextIsolation + sandbox, so the call lands here in preload where
  // electron APIs are available, and writes synchronously without a
  // permission round-trip.
  copyText: (text: string) => clipboard.writeText(text)
}

contextBridge.exposeInMainWorld('electronAPI', api)
