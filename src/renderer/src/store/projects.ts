import { create } from 'zustand'
import type { Project } from '../../../shared/types'
import { reorderById } from '../lib/reorder'
import { useSessionsStore } from './sessions'
import { useMessagesStore } from './messages'
import { stopSession } from '../ipc/bridge'

// Fire-and-forget IPC save with surfaced rejection. Without the .catch the
// renderer's in-memory state diverges from disk silently when main fails to
// write the file (permission error, disk full, IPC timeout). The console
// error gives us at least a breadcrumb in DevTools.
const saveProjects = (projects: Project[]): void => {
  window.electronAPI.invoke('projects:save', projects).catch((err: unknown) => {
    console.error('[projects:save] persistence write failed', err)
  })
}

interface ProjectsStore {
  projects: Project[]
  activeProjectId: string | null
  setProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  updateProject: (project: Project) => void
  removeProject: (id: string) => void
  // Move `fromId` to land directly before/after `toId` in the global projects
  // list, preserving relative order. Persists.
  reorderProjects: (fromId: string, toId: string, position: 'before' | 'after') => void
  setActiveProjectId: (id: string | null) => void
}

export const useProjectsStore = create<ProjectsStore>((set, get) => ({
  projects: [],
  activeProjectId: null,

  setProjects: (projects) => set({ projects }),

  addProject: (project) => {
    const updated = [...get().projects, project]
    set({ projects: updated })
    saveProjects(updated)
  },

  updateProject: (project) => {
    const updated = get().projects.map(p => p.id === project.id ? project : p)
    set({ projects: updated })
    saveProjects(updated)
  },

  removeProject: (id) => {
    // Close any open tabs for this project before dropping it. Without
    // this the tab persists in the UI pointing at a project that no
    // longer exists — sends silently fail, the StatusBar can't find
    // the env, and on next restore the tab is dropped with a console
    // warning the user never sees. Mirrors the cleanup in the
    // reset-conversation flow.
    const { sessions, tabOrder, removeSession } = useSessionsStore.getState()
    const { clearSession } = useMessagesStore.getState()
    for (const sid of tabOrder) {
      if (sessions[sid]?.projectId !== id) continue
      stopSession(sid)
      removeSession(sid)
      clearSession(sid)
    }
    const updated = get().projects.filter(p => p.id !== id)
    set({ projects: updated })
    saveProjects(updated)
  },

  reorderProjects: (fromId, toId, position) => {
    const next = reorderById(get().projects, fromId, toId, position)
    if (!next) return
    set({ projects: next })
    saveProjects(next)
  },

  setActiveProjectId: (id) => set({ activeProjectId: id })
}))
