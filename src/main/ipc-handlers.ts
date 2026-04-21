import { ipcMain, BrowserWindow } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { SessionManager } from './session-manager'
import { ProjectStore } from './project-store'
import { HistoryReader } from './history-reader'
import type { IpcChannels } from '../shared/types'

const CONFIG_PATH = join(homedir(), '.config', 'claude-launcher', 'projects.json')

export function registerIpcHandlers(mainWindow: BrowserWindow): () => void {
  const projectStore = new ProjectStore(CONFIG_PATH)
  const historyReader = new HistoryReader()

  const sessionManager = new SessionManager(
    undefined,
    (channel: string, payload: unknown) => {
      mainWindow.webContents.send(channel, payload)
    }
  )

  const handle = <K extends keyof IpcChannels>(
    channel: K,
    handler: (payload: IpcChannels[K]) => unknown
  ) => ipcMain.handle(channel as string, (_event, payload) => handler(payload))

  handle('session:start', ({ projectId, resumeSessionId }) => {
    const projects = projectStore.load()
    const project = projects.find(p => p.id === projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)
    return sessionManager.startSession(project, resumeSessionId)
  })

  handle('session:send', ({ sessionId, text }) => {
    sessionManager.sendMessage(sessionId, text)
  })

  handle('session:stop', ({ sessionId }) => {
    sessionManager.stopSession(sessionId)
  })

  handle('session:permission', ({ sessionId, decision, toolUseId }) => {
    sessionManager.respondPermission(sessionId, decision, toolUseId)
  })

  handle('projects:save', (projects) => {
    projectStore.save(projects)
  })

  handle('projects:load', async () => {
    const projects = projectStore.load()
    mainWindow.webContents.send('projects:loaded', { projects })
  })

  handle('projects:history:load', async ({ projectId }) => {
    const projects = projectStore.load()
    const project = projects.find(p => p.id === projectId)
    if (!project) return
    const entries = await historyReader.loadHistory(project.host, project.path)
    mainWindow.webContents.send('projects:history', { projectId, entries })
  })

  return () => {
    sessionManager.stopAll()
    ipcMain.removeAllListeners()
  }
}
