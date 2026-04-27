import { useState } from 'react'
import { X, Plus, Pencil, Trash2, GripVertical, BarChart3 } from 'lucide-react'
import type { Environment, HostType } from '../../../../shared/types'
import { useEnvironmentsStore } from '../../store/environments'
import { useProjectsStore } from '../../store/projects'
import { useDragReorder } from '../../hooks/useDragReorder'
import { Modal } from '../Modal'
import { EnvironmentForm } from './EnvironmentForm'
import { EnvironmentStatus } from './EnvironmentStatus'
import { UsageModal } from './UsageModal'

interface Props {
  onClose: () => void
}

export function SettingsModal({ onClose }: Props): JSX.Element {
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
    <Modal onClose={onClose} panelClassName="bg-[#1a1a1a] border border-white/10 rounded-lg w-[32rem] max-h-[90vh] overflow-hidden flex flex-col">
      <>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="text-sm font-semibold">Settings · Environments</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {editing ? (
            <EnvironmentForm
              initial={editing === 'new' ? null : editing}
              onCancel={() => setEditing(null)}
              onSave={handleSave}
            />
          ) : (
            <>
              {environments.length === 0 && (
                <p className="text-xs text-white/40 mb-3">
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
                className="mt-4 w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium border border-dashed border-white/15 rounded text-white/60 hover:text-white hover:border-white/30 transition-colors"
              >
                <Plus size={12} /> Add Environment
              </button>
            </>
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
}): JSX.Element {
  return (
    <div className="group flex items-center gap-3 px-3 py-2 rounded border border-white/10 hover:border-white/20 transition-colors">
      <GripVertical size={12} className="text-white/20 group-hover:text-white/40 cursor-grab shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate">{env.name}</div>
        <div className="text-xs text-white/40 truncate">{describeHost(env.config)}</div>
      </div>
      <EnvironmentStatus config={env.config} compact />
      <span className="text-xs text-white/30 shrink-0">
        {projectCount} project{projectCount === 1 ? '' : 's'}
      </span>
      <button
        type="button"
        onClick={onShowUsage}
        title="Show usage"
        className="p-1 rounded text-white/40 hover:text-white hover:bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <BarChart3 size={12} />
      </button>
      <button
        type="button"
        onClick={onEdit}
        title="Edit"
        className="p-1 rounded text-white/40 hover:text-white hover:bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Pencil size={12} />
      </button>
      <button
        type="button"
        onClick={onDelete}
        title="Remove"
        className="p-1 rounded text-white/40 hover:text-red-300 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function describeHost(host: HostType): string {
  if (host.kind === 'local') return 'Local'
  if (host.kind === 'wsl') return `WSL · ${host.distro}`
  // Omit user@ when blank — the label collapses to just the host alias.
  const target = host.user ? `${host.user}@${host.host}` : host.host
  return `SSH · ${target}${host.port ? `:${host.port}` : ''}`
}

function DropLine({ edge }: { edge: 'top' | 'bottom' }): JSX.Element {
  return (
    <div
      className={`absolute inset-x-1 h-0.5 bg-blue-400/80 rounded-full pointer-events-none ${
        edge === 'top' ? 'top-0' : 'bottom-0'
      }`}
    />
  )
}
