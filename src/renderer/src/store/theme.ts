import { create } from 'zustand'

export type Theme = 'system' | 'dark' | 'light'
export type Palette = 'blue' | 'violet' | 'rose' | 'emerald' | 'amber' | 'slate'

const THEME_KEY = 'claude-launcher.theme'
const PALETTE_KEY = 'claude-launcher.palette'

const THEMES: ReadonlySet<Theme> = new Set(['system', 'dark', 'light'])
const PALETTES: ReadonlySet<Palette> = new Set([
  'blue', 'violet', 'rose', 'emerald', 'amber', 'slate'
])

function loadInitial<T extends string>(key: string, allowed: ReadonlySet<T>, fallback: T): T {
  // Renderer-only setting — no IPC round-trip needed. localStorage is
  // synchronous so we can apply data-* before first paint via
  // bootstrapTheme(), avoiding a flash-of-wrong-look when switching
  // from default to a saved preference.
  try {
    const v = localStorage.getItem(key)
    if (v && allowed.has(v as T)) return v as T
  } catch { /* localStorage may be disabled — fall through to default */ }
  return fallback
}

function persist(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}

interface ThemeStore {
  theme: Theme
  palette: Palette
  setTheme: (theme: Theme) => void
  setPalette: (palette: Palette) => void
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: loadInitial<Theme>(THEME_KEY, THEMES, 'system'),
  palette: loadInitial<Palette>(PALETTE_KEY, PALETTES, 'blue'),
  setTheme: (theme) => {
    persist(THEME_KEY, theme)
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },
  setPalette: (palette) => {
    persist(PALETTE_KEY, palette)
    document.documentElement.setAttribute('data-palette', palette)
    set({ palette })
  }
}))

// Apply both attributes once on module load so the very first paint
// already has the right look. Called from main.tsx's import side-effect
// chain, before React renders.
export function bootstrapTheme(): void {
  const { theme, palette } = useThemeStore.getState()
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.setAttribute('data-palette', palette)
}
