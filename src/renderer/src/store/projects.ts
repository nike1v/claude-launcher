import { create } from 'zustand'
import type { Project } from '../../../shared/types'

interface ProjectsStore {
  projects: Project[]
  activeProjectId: string | null
  setProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  updateProject: (project: Project) => void
  removeProject: (id: string) => void
  setActiveProjectId: (id: string | null) => void
}

export const useProjectsStore = create<ProjectsStore>((set, get) => ({
  projects: [],
  activeProjectId: null,

  setProjects: (projects) => set({ projects }),

  addProject: (project) => {
    const updated = [...get().projects, project]
    set({ projects: updated })
    window.electronAPI.invoke('projects:save', updated)
  },

  updateProject: (project) => {
    const updated = get().projects.map(p => p.id === project.id ? project : p)
    set({ projects: updated })
    window.electronAPI.invoke('projects:save', updated)
  },

  removeProject: (id) => {
    const updated = get().projects.filter(p => p.id !== id)
    set({ projects: updated })
    window.electronAPI.invoke('projects:save', updated)
  },

  setActiveProjectId: (id) => set({ activeProjectId: id })
}))
