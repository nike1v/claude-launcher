import { contextBridge, ipcRenderer } from 'electron'
import type { IpcChannels, IpcEventChannel } from '../shared/types'

const api = {
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
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

declare global {
  interface Window {
    electronAPI: typeof api
  }
}
