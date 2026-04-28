import { useState } from 'react'
import { X, Plus, Pencil, Trash2, GripVertical, BarChart3, Monitor, Sun, Moon } from 'lucide-react'
import type { Environment } from '../../../../shared/types'
import { describeHost } from '../../../../shared/host-utils'
import { useEnvironmentsStore } from '../../store/environments'
import { useProjectsStore } from '../../store/projects'
import { useThemeStore, type Theme } from '../../store/theme'
import { useDragReorder } from '../../hooks/useDragReorder'
import { Modal } from '../Modal'
import { EnvironmentForm } from './EnvironmentForm'
import { EnvironmentStatus } from './EnvironmentStatus'
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
      <EnvironmentStatus config={env.config} compact />
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
// theme regardless of OS pref. Stored only in localStorage — no IPC needed
// for a renderer-only setting.
const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string; icon: typeof Monitor; hint: string }> = [
  { value: 'system', label: 'System', icon: Monitor, hint: 'Match OS preference' },
  { value: 'light', label: 'Light', icon: Sun, hint: 'Light background' },
  { value: 'dark', label: 'Dark', icon: Moon, hint: 'Dark background' }
]

function AppearanceSection() {
  const theme = useThemeStore(s => s.theme)
  const setTheme = useThemeStore(s => s.setTheme)
  return (
    <section>
      <SectionHeader>Appearance</SectionHeader>
      <div className="grid grid-cols-3 gap-2">
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
                  ? 'bg-elevated border-divider-strong text-fg'
                  : 'border-divider text-fg-muted hover:border-divider-strong hover:text-fg'}
              `}
            >
              <Icon size={16} />
              <span>{opt.label}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
