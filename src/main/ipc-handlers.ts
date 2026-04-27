import { ipcMain, BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import { SessionManager } from './session-manager'
import { ProjectStore } from './project-store'
import { EnvironmentStore, migrateProjectsToEnvironments } from './environment-store'
import { TabStore } from './tab-store'
import { HistoryReader } from './history-reader'
import type { IpcChannels } from '../shared/types'

const CONFIG_DIR = join(homedir(), '.config', 'claude-launcher')
const PROJECTS_PATH = join(CONFIG_DIR, 'projects.json')
const ENVIRONMENTS_PATH = join(CONFIG_DIR, 'environments.json')
const TABS_PATH = join(CONFIG_DIR, 'tabs.json')

export function registerIpcHandlers(mainWindow: BrowserWindow): () => Promise<void> {
  const projectStore = new ProjectStore(PROJECTS_PATH)
  const environmentStore = new EnvironmentStore(ENVIRONMENTS_PATH)
  const tabStore = new TabStore(TABS_PATH)
  const historyReader = new HistoryReader()
  let stopped = false

  // One-shot migration: existing installs have a flat projects.json with a
  // `host` per project. Lift unique hosts into environments.json and rewrite
  // projects.json so each project references its environment by id.
  runEnvironmentMigration(projectStore, environmentStore)

  const safeSend = (channel: string, payload: unknown): void => {
    if (stopped || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(channel, payload)
  }

  const sessionManager = new SessionManager(undefined, safeSend)

  const handle = <K extends keyof IpcChannels>(
    channel: K,
    handler: (payload: IpcChannels[K]) => unknown
  ) => ipcMain.handle(channel as string, (_event, payload) => handler(payload))

  handle('session:start', ({ projectId, resumeSessionId }) => {
    const project = projectStore.load().find(p => p.id === projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)
    const env = environmentStore.load().find(e => e.id === project.environmentId)
    if (!env) throw new Error(`Environment ${project.environmentId} not found for project ${projectId}`)
    return sessionManager.startSession(env, project, resumeSessionId)
  })

  handle('session:send', ({ sessionId, text, attachments }) => {
    sessionManager.sendMessage(sessionId, text, attachments)
  })

  handle('dialog:saveFile', async ({ defaultName, mediaType, data }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: filtersFor(defaultName, mediaType)
    })
    if (result.canceled || !result.filePath) return { saved: false }
    await writeFile(result.filePath, Buffer.from(data, 'base64'))
    return { saved: true, path: result.filePath }
  })

  handle('session:stop', ({ sessionId }) => {
    sessionManager.stopSession(sessionId)
  })

  handle('session:interrupt', ({ sessionId }) => {
    sessionManager.interruptSession(sessionId)
  })

  handle('session:permission', ({ sessionId, decision, toolUseId }) => {
    sessionManager.respondPermission(sessionId, decision, toolUseId)
  })

  handle('projects:save', (projects) => {
    projectStore.save(projects)
  })

  handle('projects:load', async () => {
    const projects = projectStore.load()
    safeSend('projects:loaded', { projects })
  })

  handle('environments:save', (envs) => {
    environmentStore.save(envs)
  })

  handle('environments:load', async () => {
    const environments = environmentStore.load()
    safeSend('environments:loaded', { environments })
  })

  handle('projects:history:load', async ({ projectId }) => {
    const ctx = resolveProjectAndEnv(projectStore, environmentStore, projectId)
    if (!ctx) return
    const entries = await historyReader.loadHistory(ctx.env.config, ctx.project.path)
    safeSend('projects:history', { projectId, entries })
  })

  handle('session:history:load', async ({ projectId, sessionId }) => {
    const ctx = resolveProjectAndEnv(projectStore, environmentStore, projectId)
    if (!ctx) return []
    return historyReader.loadSessionEvents(ctx.env.config, ctx.project.path, sessionId)
  })

  handle('tabs:load', () => tabStore.load())
  handle('tabs:save', (state) => { tabStore.save(state) })

  return async () => {
    stopped = true
    const channels = [
      'session:start', 'session:send', 'session:stop', 'session:interrupt', 'session:permission',
      'projects:save', 'projects:load', 'projects:history:load', 'session:history:load',
      'environments:save', 'environments:load',
      'tabs:load', 'tabs:save', 'dialog:saveFile'
    ]
    channels.forEach(ch => ipcMain.removeHandler(ch))
    await sessionManager.stopAll()
  }
}

function resolveProjectAndEnv(
  projectStore: ProjectStore,
  environmentStore: EnvironmentStore,
  projectId: string
): { project: import('../shared/types').Project; env: import('../shared/types').Environment } | null {
  const project = projectStore.load().find(p => p.id === projectId)
  if (!project) return null
  const env = environmentStore.load().find(e => e.id === project.environmentId)
  if (!env) return null
  return { project, env }
}

function runEnvironmentMigration(projectStore: ProjectStore, envStore: EnvironmentStore): void {
  const rawProjects = projectStore.load() as unknown[]
  const existingEnvs = envStore.load()
  const result = migrateProjectsToEnvironments(rawProjects, existingEnvs)
  if (!result.changed && envStore.exists()) return
  envStore.save(result.environments)
  projectStore.save(result.projects)
}

function filtersFor(name: string, mediaType: string): Electron.FileFilter[] {
  const ext = extname(name).replace(/^\./, '').toLowerCase()
  if (ext) return [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'All Files', extensions: ['*'] }]
  // Fall back to a guess from the media type.
  const fromMime = mediaType.split('/')[1]?.toLowerCase()
  if (fromMime) return [{ name: fromMime.toUpperCase(), extensions: [fromMime] }, { name: 'All Files', extensions: ['*'] }]
  return [{ name: 'All Files', extensions: ['*'] }]
}
