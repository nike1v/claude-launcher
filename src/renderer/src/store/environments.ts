import { create } from 'zustand'
import type { Environment } from '../../../shared/types'

interface EnvironmentsStore {
  environments: Environment[]
  setEnvironments: (envs: Environment[]) => void
  addEnvironment: (env: Environment) => void
  updateEnvironment: (env: Environment) => void
  removeEnvironment: (id: string) => void
  // Move `fromId` to land directly before/after `toId` in the env list. Persists.
  reorderEnvironments: (fromId: string, toId: string, position: 'before' | 'after') => void
}

export const useEnvironmentsStore = create<EnvironmentsStore>((set, get) => ({
  environments: [],

  setEnvironments: (environments) => set({ environments }),

  addEnvironment: (env) => {
    const updated = [...get().environments, env]
    set({ environments: updated })
    window.electronAPI.invoke('environments:save', updated)
  },

  updateEnvironment: (env) => {
    const updated = get().environments.map(e => e.id === env.id ? env : e)
    set({ environments: updated })
    window.electronAPI.invoke('environments:save', updated)
  },

  removeEnvironment: (id) => {
    const updated = get().environments.filter(e => e.id !== id)
    set({ environments: updated })
    window.electronAPI.invoke('environments:save', updated)
  },

  reorderEnvironments: (fromId, toId, position) => {
    if (fromId === toId) return
    const current = get().environments
    const fromIdx = current.findIndex(e => e.id === fromId)
    const toIdx = current.findIndex(e => e.id === toId)
    if (fromIdx < 0 || toIdx < 0) return
    const next = [...current]
    const [moved] = next.splice(fromIdx, 1)
    let insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx
    if (position === 'after') insertAt += 1
    next.splice(insertAt, 0, moved)
    set({ environments: next })
    window.electronAPI.invoke('environments:save', next)
  }
}))
