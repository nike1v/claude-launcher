import { ipcMain, BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import { SessionManager } from './session-manager'
import { ProjectStore } from './project-store'
import { EnvironmentStore, migrateProjectsToEnvironments } from './environment-store'
import { TabStore } from './tab-store'
import { HistoryReader } from './history-reader'
import { listDir } from './dir-lister'
import { probeUsage } from './usage-probe'
import { resolveTransport } from './transports'
import { sanitizeDefaultName, validateSaveFilePayload } from './attachment-limits'
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

  // Track every channel handle() registers so teardown can unhook them
  // automatically. The previous version maintained a hardcoded array that
  // had to be kept in sync with each `handle('foo', ...)` call below — and
  // didn't (the boot-smoke test asserted a list that was already stale by
  // the time dialog:saveFile shipped).
  const registered = new Set<string>()
  const handle = <K extends keyof IpcChannels>(
    channel: K,
    handler: (payload: IpcChannels[K]) => unknown
  ) => {
    registered.add(channel as string)
    ipcMain.handle(channel as string, async (_event, payload) => {
      try {
        return await handler(payload)
      } catch (err) {
        // Re-throw so the renderer's .catch path still fires, but log the
        // full error here. Without this, IPC failures only surface as the
        // renderer's "Error invoking remote method" with no context, which
        // makes diagnosing prod issues a guessing game.
        console.error(`[ipc] ${channel} threw:`, err)
        throw err
      }
    })
  }

  handle('session:start', async ({ projectId, resumeSessionId }) => {
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
    // Reject before opening the dialog so a malicious renderer can't OOM us
    // by sending multi-GB base64. Also strip path separators / control chars
    // from the suggested name — the user picks the actual path, but the
    // suggestion shouldn't silently traverse out of their pwd.
    validateSaveFilePayload(data)
    const safeName = sanitizeDefaultName(defaultName)
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: safeName,
      filters: filtersFor(safeName, mediaType)
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

  handle('environments:probe', async ({ config }) => {
    const transport = resolveTransport(config)
    return transport.probe(config)
  })

  handle('environments:usage', async ({ config }) => {
    // Wrap so the IPC channel always resolves with our { ok, reason }
    // shape — a thrown error here would reject the promise and surface
    // as an opaque "Error invoking remote method" in the renderer (and
    // can take down the modal if it's not in the right error path).
    try {
      return await probeUsage(config)
    } catch (err) {
      // Do NOT include err.stack here — that surfaces internal asar paths
      // and node_modules layout to the renderer (and into the Settings
      // modal DOM), which is useful info for an attacker chaining a
      // hypothetical assistant-output XSS. The console.error in the IPC
      // wrapper still has the full stack for debugging.
      const reason = err instanceof Error ? err.message : String(err)
      return { ok: false, reason: `usage probe crashed: ${reason}` }
    }
  })

  handle('fs:listDir', async ({ config, path }) => {
    try {
      return await listDir(config, path)
    } catch (err) {
      // Surface a structured error so the renderer can show "no suggestions"
      // rather than crashing or pretending the dir was empty.
      return { cwd: path, entries: [], error: err instanceof Error ? err.message : String(err) }
    }
  })

  handle('session:history:load', async ({ projectId, sessionId }) => {
    const ctx = resolveProjectAndEnv(projectStore, environmentStore, projectId)
    if (!ctx) return { events: [], diagnostic: `project ${projectId} or its environment not found` }
    return historyReader.loadSessionEvents(ctx.env.config, ctx.project.path, sessionId)
  })

  handle('tabs:load', () => tabStore.load())
  handle('tabs:save', (state) => { tabStore.save(state) })

  return async () => {
    stopped = true
    for (const channel of registered) ipcMain.removeHandler(channel)
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
