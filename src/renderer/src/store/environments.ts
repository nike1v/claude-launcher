import { create } from 'zustand'
import type { Environment } from '../../../shared/types'

interface EnvironmentsStore {
  environments: Environment[]
  setEnvironments: (envs: Environment[]) => void
  addEnvironment: (env: Environment) => void
  updateEnvironment: (env: Environment) => void
  removeEnvironment: (id: string) => void
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
  }
}))
