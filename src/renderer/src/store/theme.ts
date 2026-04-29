import { create } from 'zustand'

export type Theme = 'system' | 'dark' | 'light' | 'high-contrast'
export type Palette = 'blue' | 'violet' | 'rose' | 'emerald' | 'amber' | 'slate'

const THEME_KEY = 'claude-launcher.theme'
const PALETTE_KEY = 'claude-launcher.palette'
const ZOOM_KEY = 'claude-launcher.zoom'

const THEMES: ReadonlySet<Theme> = new Set(['system', 'dark', 'light', 'high-contrast'])
const PALETTES: ReadonlySet<Palette> = new Set([
  'blue', 'violet', 'rose', 'emerald', 'amber', 'slate'
])

// Bounds match Chromium's webFrame.setZoomLevel native cap, but we tighten
// the floor so a stuck Ctrl/Cmd+- doesn't make the UI illegible.
const MIN_ZOOM = -3
const MAX_ZOOM = 5

function loadString<T extends string>(key: string, allowed: ReadonlySet<T>, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    if (v && allowed.has(v as T)) return v as T
  } catch { /* ignore — disabled storage means we use the default */ }
  return fallback
}

function loadZoom(): number {
  try {
    const v = localStorage.getItem(ZOOM_KEY)
    if (v === null) return 0
    const n = Number(v)
    if (Number.isFinite(n) && n >= MIN_ZOOM && n <= MAX_ZOOM) return n
  } catch { /* ignore */ }
  return 0
}

function persist(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}

interface ThemeStore {
  theme: Theme
  palette: Palette
  zoom: number
  setTheme: (theme: Theme) => void
  setPalette: (palette: Palette) => void
  setZoom: (zoom: number) => void
  // Convenience deltas for the keyboard shortcuts. Clamp to MIN/MAX so
  // a held key doesn't push the UI into unusable territory.
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
}

const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: loadString<Theme>(THEME_KEY, THEMES, 'system'),
  palette: loadString<Palette>(PALETTE_KEY, PALETTES, 'blue'),
  zoom: loadZoom(),
  setTheme: (theme) => {
    persist(THEME_KEY, theme)
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },
  setPalette: (palette) => {
    persist(PALETTE_KEY, palette)
    document.documentElement.setAttribute('data-palette', palette)
    set({ palette })
  },
  setZoom: (zoom) => {
    const clamped = clampZoom(zoom)
    persist(ZOOM_KEY, String(clamped))
    window.electronAPI.setZoomLevel(clamped)
    set({ zoom: clamped })
  },
  zoomIn: () => get().setZoom(get().zoom + 1),
  zoomOut: () => get().setZoom(get().zoom - 1),
  zoomReset: () => get().setZoom(0)
}))

// Apply theme + palette + zoom once on module load, before React renders.
// Without this we'd flash the default look on every cold open.
export function bootstrapTheme(): void {
  const { theme, palette, zoom } = useThemeStore.getState()
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.setAttribute('data-palette', palette)
  // setZoomLevel is a no-op if the value matches what Chromium already
  // has, so it's safe to call unconditionally on every bootstrap.
  window.electronAPI.setZoomLevel(zoom)
}
