import { create } from 'zustand'

export type Theme = 'system' | 'dark' | 'light'

const STORAGE_KEY = 'claude-launcher.theme'

function loadInitial(): Theme {
  // Renderer-only setting — no IPC round-trip needed. localStorage is
  // synchronous so we can apply data-theme before first paint via
  // applyTheme() in the bootstrapper, avoiding a flash-of-unstyled-content
  // when switching from default dark to a saved light preference.
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'system' || v === 'dark' || v === 'light') return v
  } catch { /* localStorage may be disabled — fall through to default */ }
  return 'system'
}

function persist(theme: Theme): void {
  try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* ignore */ }
}

interface ThemeStore {
  theme: Theme
  setTheme: (theme: Theme) => void
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: loadInitial(),
  setTheme: (theme) => {
    persist(theme)
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  }
}))

// Apply once on module load so the very first paint already has the right
// theme. Called from main.tsx's import side-effect chain.
export function bootstrapTheme(): void {
  const theme = useThemeStore.getState().theme
  document.documentElement.setAttribute('data-theme', theme)
}
