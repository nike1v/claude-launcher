import { useState } from 'react'
import { X, Plus, Pencil, Trash2, GripVertical, BarChart3, Monitor, Sun, Moon, Contrast, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import type { Environment } from '../../../../shared/types'
import { describeHost } from '../../../../shared/host-utils'
import { useEnvironmentsStore } from '../../store/environments'
import { useProjectsStore } from '../../store/projects'
import { useThemeStore, type Theme, type Palette } from '../../store/theme'
import { useDragReorder } from '../../hooks/useDragReorder'
import { Modal } from '../Modal'
import { EnvironmentForm } from './EnvironmentForm'
import { ProvidersStatus } from './ProvidersStatus'
import { UsageModal } from './UsageModal'

interface Props {
  onClose: () => void
}

export function SettingsModal({ onClose }: Props) {
  const { environments, addEnvironment, updateEnvironment, removeEnvironment, reorderEnvironments } = useEnvironmentsStore()
  const { projects } = useProjectsStore()
  const [editing, setEditing] = useState<Environment | 'new' | null>(null)
  const [showUsageFor, setShowUsageFor] = useState<Environment | null>(null)
  const dnd = useDragReorder({ onReorder: reorderEnvironments })

  const projectsForEnv = (envId: string): number =>
    projects.filter(p => p.environmentId === envId).length

  const handleSave = (env: Environment) => {
    if (editing === 'new') addEnvironment(env)
    else updateEnvironment(env)
    setEditing(null)
  }

  const handleDelete = (env: Environment) => {
    const count = projectsForEnv(env.id)
    if (count > 0) {
      if (!window.confirm(`Remove "${env.name}" and ${count} project${count === 1 ? '' : 's'}?`)) return
      const projectsStore = useProjectsStore.getState()
      for (const p of projects.filter(p => p.environmentId === env.id)) {
        projectsStore.removeProject(p.id)
      }
    } else if (!window.confirm(`Remove "${env.name}"?`)) return
    removeEnvironment(env.id)
  }

  return (
    <Modal onClose={onClose} panelClassName="bg-panel border border-divider rounded-lg w-[32rem] max-h-[90vh] overflow-hidden flex flex-col">
      <>
        <div className="flex items-center justify-between px-5 py-4 border-b border-divider">
          <h2 className="text-sm font-semibold">Settings</h2>
          <button onClick={onClose} className="text-fg-faint hover:text-fg">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {!editing && <AppearanceSection />}
          {editing ? (
            <EnvironmentForm
              initial={editing === 'new' ? null : editing}
              onCancel={() => setEditing(null)}
              onSave={handleSave}
            />
          ) : (
            <section>
              <SectionHeader>Environments</SectionHeader>
              {environments.length === 0 && (
                <p className="text-xs text-fg-faint mb-3">
                  No environments yet. Add one to start running projects.
                </p>
              )}
              <div className="space-y-1.5">
                {environments.map(env => {
                  const dropping = dnd.isDropTarget(env.id)
                  const above = dropping && dnd.dropPosition === 'before'
                  const below = dropping && dnd.dropPosition === 'after'
                  return (
                    <div
                      key={env.id}
                      {...dnd.bindRow(env.id)}
                      className={`relative ${dnd.isDragging(env.id) ? 'opacity-40' : ''}`}
                    >
                      {above && <DropLine edge="top" />}
                      <EnvironmentRow
                        env={env}
                        projectCount={projectsForEnv(env.id)}
                        onEdit={() => setEditing(env)}
                        onDelete={() => handleDelete(env)}
                        onShowUsage={() => setShowUsageFor(env)}
                      />
                      {below && <DropLine edge="bottom" />}
                    </div>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={() => setEditing('new')}
                className="mt-4 w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium border border-dashed border-divider rounded text-fg-muted hover:text-fg hover:border-divider-strong transition-colors"
              >
                <Plus size={12} /> Add Environment
              </button>
            </section>
          )}
        </div>
      </>
      {showUsageFor && (
        <UsageModal env={showUsageFor} onClose={() => setShowUsageFor(null)} />
      )}
    </Modal>
  )
}

function EnvironmentRow({
  env,
  projectCount,
  onEdit,
  onDelete,
  onShowUsage
}: {
  env: Environment
  projectCount: number
  onEdit: () => void
  onDelete: () => void
  onShowUsage: () => void
}) {
  return (
    <div className="group flex items-center gap-3 px-3 py-2 rounded border border-divider hover:border-divider-strong transition-colors">
      <GripVertical size={12} className="text-fg-faint group-hover:text-fg-faint cursor-grab shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-fg truncate">{env.name}</div>
        <div className="text-xs text-fg-faint truncate">{describeHost(env.config)}</div>
      </div>
      <ProvidersStatus config={env.config} defaultProviderKind={env.providerKind} envName={env.name} />
      {/* Fixed width + right-align so "1 project" and "4 projects" occupy the
          same column across rows — otherwise the trailing action icons land
          at different x positions per row when revealed on hover. */}
      <span className="text-xs text-fg-faint shrink-0 w-20 text-right tabular-nums">
        {projectCount} project{projectCount === 1 ? '' : 's'}
      </span>
      <button
        type="button"
        onClick={onShowUsage}
        title="Show usage"
        className="p-1 rounded text-fg-faint hover:text-fg hover:bg-elevated opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <BarChart3 size={12} />
      </button>
      <button
        type="button"
        onClick={onEdit}
        title="Edit"
        className="p-1 rounded text-fg-faint hover:text-fg hover:bg-elevated opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Pencil size={12} />
      </button>
      <button
        type="button"
        onClick={onDelete}
        title="Remove"
        className="p-1 rounded text-fg-faint hover:text-danger hover:bg-danger/12 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function DropLine({ edge }: { edge: 'top' | 'bottom' }) {
  return (
    <div
      className={`absolute inset-x-1 h-0.5 bg-accent/80 rounded-full pointer-events-none ${
        edge === 'top' ? 'top-0' : 'bottom-0'
      }`}
    />
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-faint mb-2">
      {children}
    </h3>
  )
}

// "system" defers to the OS color scheme; the explicit options force a
// theme regardless of OS pref. high-contrast is the accessibility variant —
// pure black/white extremes, much stronger borders, all text readable.
// Stored only in localStorage — no IPC needed for a renderer-only setting.
const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string; icon: typeof Monitor; hint: string }> = [
  { value: 'system', label: 'System', icon: Monitor, hint: 'Match OS preference' },
  { value: 'light', label: 'Light', icon: Sun, hint: 'Light background' },
  { value: 'dark', label: 'Dark', icon: Moon, hint: 'Dark background' },
  { value: 'high-contrast', label: 'Contrast', icon: Contrast, hint: 'High contrast (accessibility)' }
]

// Palette = accent colour family. Independent of theme: Blue + Dark and
// Blue + Light share the same hue, just at different lightness levels
// the index.css's --pl-accent-d / --pl-accent-l swatches handle. Each
// preview swatch shows the dark variant since most users start there;
// in light theme the active accent will be a bit darker than what the
// swatch shows (still the same hue family).
const PALETTE_OPTIONS: ReadonlyArray<{ value: Palette; label: string; swatch: string }> = [
  { value: 'blue', label: 'Blue', swatch: '#4f8cff' },
  { value: 'violet', label: 'Violet', swatch: '#a78bfa' },
  { value: 'rose', label: 'Rose', swatch: '#fb7185' },
  { value: 'emerald', label: 'Emerald', swatch: '#34d399' },
  { value: 'amber', label: 'Amber', swatch: '#fbbf24' },
  { value: 'slate', label: 'Slate', swatch: '#94a3b8' }
]

function AppearanceSection() {
  const theme = useThemeStore(s => s.theme)
  const setTheme = useThemeStore(s => s.setTheme)
  const palette = useThemeStore(s => s.palette)
  const setPalette = useThemeStore(s => s.setPalette)
  const zoom = useThemeStore(s => s.zoom)
  const zoomIn = useThemeStore(s => s.zoomIn)
  const zoomOut = useThemeStore(s => s.zoomOut)
  const zoomReset = useThemeStore(s => s.zoomReset)
  const clockFormat = useThemeStore(s => s.clockFormat)
  const setClockFormat = useThemeStore(s => s.setClockFormat)
  // Approximate the visual zoom % the way Chromium does: each integer
  // step of webFrame.zoomLevel is a 1.2× factor.
  const zoomPercent = Math.round(Math.pow(1.2, zoom) * 100)
  return (
    <section className="space-y-3">
      <SectionHeader>Appearance</SectionHeader>
      <div className="grid grid-cols-4 gap-2">
        {THEME_OPTIONS.map(opt => {
          const Icon = opt.icon
          const active = theme === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTheme(opt.value)}
              title={opt.hint}
              aria-pressed={active}
              className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded border text-xs transition-colors
                ${active
                  ? 'bg-accent/10 border-accent/60 text-fg'
                  : 'border-divider text-fg-muted hover:border-divider-strong hover:text-fg'}
              `}
            >
              <Icon size={16} />
              <span>{opt.label}</span>
            </button>
          )
        })}
      </div>

      {/* Zoom controls — also wired to Ctrl/Cmd + / − / 0 globally. */}
      <div>
        <p className="text-[11px] text-fg-faint mb-1.5">
          Zoom <span className="text-fg-muted ml-1">({zoomPercent}%)</span>
          <span className="ml-2 text-fg-faint">
            {window.electronAPI.platform === 'darwin' ? '⌘' : 'Ctrl'} + /
            {window.electronAPI.platform === 'darwin' ? ' ⌘' : ' Ctrl'} − /
            {window.electronAPI.platform === 'darwin' ? ' ⌘' : ' Ctrl'} 0
          </span>
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={zoomOut}
            title="Zoom out"
            className="p-1.5 rounded border border-divider text-fg-muted hover:text-fg hover:border-divider-strong transition-colors"
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            onClick={zoomReset}
            title="Reset zoom"
            className="p-1.5 rounded border border-divider text-fg-muted hover:text-fg hover:border-divider-strong transition-colors"
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            onClick={zoomIn}
            title="Zoom in"
            className="p-1.5 rounded border border-divider text-fg-muted hover:text-fg hover:border-divider-strong transition-colors"
          >
            <ZoomIn size={14} />
          </button>
        </div>
      </div>

      {/* Clock format — drives the HH:MM stamp on each message bubble.
          Default 24h because Electron's locale detection isn't reliable
          enough across WSL/Windows/macOS/SSH to auto-pick the right one. */}
      <div>
        <p className="text-[11px] text-fg-faint mb-1.5">Clock format</p>
        <div className="grid grid-cols-2 gap-2">
          {(['24h', '12h'] as const).map(opt => {
            const active = clockFormat === opt
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setClockFormat(opt)}
                aria-pressed={active}
                className={`px-3 py-1.5 rounded border text-xs transition-colors
                  ${active
                    ? 'bg-accent/10 border-accent/60 text-fg'
                    : 'border-divider text-fg-muted hover:border-divider-strong hover:text-fg'}
                `}
              >
                {opt === '24h' ? '24-hour (14:45)' : '12-hour (2:45 PM)'}
              </button>
            )
          })}
        </div>
      </div>

      {/* Accent palette — orthogonal to theme. Sets only the accent + user
          bubble colours; surface tones (panels, text) stay theme-driven. */}
      <div>
        <p className="text-[11px] text-fg-faint mb-1.5">Accent</p>
        <div className="flex items-center gap-2 flex-wrap">
          {PALETTE_OPTIONS.map(opt => {
            const active = palette === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPalette(opt.value)}
                title={opt.label}
                aria-label={`${opt.label} accent`}
                aria-pressed={active}
                className={`group relative w-7 h-7 rounded-full transition-transform ${
                  active ? 'scale-110' : 'hover:scale-105'
                }`}
              >
                <span
                  className={`absolute inset-0 rounded-full border-2 ${
                    active ? 'border-accent' : 'border-transparent group-hover:border-fg-faint'
                  }`}
                />
                <span
                  className="absolute inset-1 rounded-full"
                  style={{ background: opt.swatch }}
                />
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
