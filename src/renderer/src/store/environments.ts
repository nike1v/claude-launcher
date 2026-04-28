import { create } from 'zustand'
import type { Environment } from '../../../shared/types'
import { reorderById } from '../lib/reorder'

const saveEnvironments = (envs: Environment[]): void => {
  window.electronAPI.invoke('environments:save', envs).catch((err: unknown) => {
    console.error('[environments:save] persistence write failed', err)
  })
}

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
    saveEnvironments(updated)
  },

  updateEnvironment: (env) => {
    const updated = get().environments.map(e => e.id === env.id ? env : e)
    set({ environments: updated })
    saveEnvironments(updated)
  },

  removeEnvironment: (id) => {
    const updated = get().environments.filter(e => e.id !== id)
    set({ environments: updated })
    saveEnvironments(updated)
  },

  reorderEnvironments: (fromId, toId, position) => {
    const next = reorderById(get().environments, fromId, toId, position)
    if (!next) return
    set({ environments: next })
    saveEnvironments(next)
  }
}))
