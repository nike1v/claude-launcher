import { create } from 'zustand'
import type { Project } from '../../../shared/types'
import { reorderById } from '../lib/reorder'

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
