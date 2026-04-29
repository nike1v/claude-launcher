import { contextBridge, ipcRenderer, webFrame } from 'electron'
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

  // Native clipboard write — routes through main via IPC because:
  //   1. navigator.clipboard.writeText goes through Chromium's permission
  //      API, which our deny-all setPermissionRequestHandler (v0.4.4) blocks.
  //   2. The `clipboard` electron module is NOT in the sandboxed preload's
  //      allow-list (only contextBridge / ipcRenderer / webFrame /
  //      crashReporter / nativeImage / webUtils are available there).
  // So we hop to main via IPC, where the full electron API is reachable,
  // and main calls clipboard.writeText() from there.
  copyText: (text: string) => { ipcRenderer.invoke('clipboard:write', text) }
}

contextBridge.exposeInMainWorld('electronAPI', api)
