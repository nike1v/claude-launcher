import { contextBridge, ipcRenderer } from 'electron'

// Expose a typed API to the renderer via contextBridge.
// Additional handlers will be added in later tasks.
contextBridge.exposeInMainWorld('electronAPI', {
  versions: {
    node: (): string => process.versions.node,
    chrome: (): string => process.versions.chrome,
    electron: (): string => process.versions.electron
  },
  ipcRenderer: {
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      ipcRenderer.on(channel, (_event, ...args) => listener(...args))
    },
    removeAllListeners: (channel: string) => {
      ipcRenderer.removeAllListeners(channel)
    },
    invoke: (channel: string, ...args: unknown[]) => {
      return ipcRenderer.invoke(channel, ...args)
    }
  }
})
