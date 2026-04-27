import { useState } from 'react'
import { X } from 'lucide-react'
import type { Environment, HostType, Project } from '../../../../shared/types'
import { useProjectsStore } from '../../store/projects'
import { useEnvironmentsStore } from '../../store/environments'
import { Modal } from '../Modal'

interface Props {
  onClose: () => void
  editProject?: Project
  // Pre-bind the project to a specific environment. When set, the host
  // fields are hidden and the project is created against this env.
  presetEnvironmentId?: string
}

// WSL is Windows-only.
const HOST_KINDS: ReadonlyArray<'local' | 'wsl' | 'ssh'> =
  window.electronAPI.platform === 'win32'
    ? ['local', 'wsl', 'ssh']
    : ['local', 'ssh']

// Phase 1 modal: still handles the legacy inline "host + project" form, but
// now resolves (or creates) an Environment under the hood and stores
// project.environmentId. Phase 2 will replace this with a proper Settings
// modal that manages environments separately.
export function AddProjectModal({ onClose, editProject, presetEnvironmentId }: Props): JSX.Element {
  const { addProject, updateProject } = useProjectsStore()
  const { environments, addEnvironment } = useEnvironmentsStore()

  const editEnv = editProject
    ? environments.find(e => e.id === editProject.environmentId)
    : presetEnvironmentId
    ? environments.find(e => e.id === presetEnvironmentId)
    : undefined
  const lockedToEnv = !!presetEnvironmentId || !!editProject

  const [name, setName] = useState(editProject?.name ?? '')
  const [path, setPath] = useState(editProject?.path ?? '')
  const [model, setModel] = useState(editProject?.model ?? '')
  const [hostKind, setHostKind] = useState<'local' | 'wsl' | 'ssh'>(
    editEnv?.config.kind ?? 'local'
  )
  const [distro, setDistro] = useState(
    editEnv?.config.kind === 'wsl' ? editEnv.config.distro : 'Ubuntu'
  )
  const [sshUser, setSshUser] = useState(
    editEnv?.config.kind === 'ssh' ? editEnv.config.user : ''
  )
  const [sshHost, setSshHost] = useState(
    editEnv?.config.kind === 'ssh' ? editEnv.config.host : ''
  )
  const [sshPort, setSshPort] = useState(
    editEnv?.config.kind === 'ssh' ? String(editEnv.config.port ?? '') : ''
  )
  const [sshKeyFile, setSshKeyFile] = useState(
    editEnv?.config.kind === 'ssh' ? (editEnv.config.keyFile ?? '') : ''
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !path.trim()) return

    let envId: string
    if (presetEnvironmentId && !editProject) {
      envId = presetEnvironmentId
    } else if (editProject) {
      envId = editProject.environmentId
    } else {
      const host: HostType =
        hostKind === 'local'
          ? { kind: 'local' }
          : hostKind === 'wsl'
          ? { kind: 'wsl', distro: distro.trim() }
          : {
              kind: 'ssh',
              user: sshUser.trim(),
              host: sshHost.trim(),
              port: sshPort ? Number(sshPort) : undefined,
              keyFile: sshKeyFile.trim() || undefined
            }
      envId = findOrCreateEnvironment(environments, host, addEnvironment).id
    }

    const project: Project = {
      id: editProject?.id ?? crypto.randomUUID(),
      name: name.trim(),
      environmentId: envId,
      path: path.trim(),
      model: model.trim() || undefined
    }

    if (editProject) updateProject(project)
    else addProject(project)
    onClose()
  }

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30'
  const labelCls = 'block text-xs text-white/50 mb-1'

  return (
    <Modal onClose={onClose} panelClassName="bg-[#1a1a1a] border border-white/10 rounded-lg p-5 w-96 max-h-[90vh] overflow-y-auto">
      <>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">{editProject ? 'Edit Project' : 'Add Project'}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelCls}>Name</label>
            <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="My Project" />
          </div>

          {lockedToEnv && editEnv ? (
            <div>
              <label className={labelCls}>Environment</label>
              <div className="text-xs text-white/60 px-2 py-1.5 rounded bg-white/[0.04] border border-white/10">
                {editEnv.name}
              </div>
            </div>
          ) : (
            <div>
              <label className={labelCls}>Host Type</label>
              <div className="flex gap-2">
                {HOST_KINDS.map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setHostKind(k)}
                    className={`flex-1 py-1.5 text-xs rounded border transition-colors
                      ${hostKind === k
                        ? 'bg-white/10 border-white/30 text-white'
                        : 'border-white/10 text-white/40 hover:border-white/20'}
                    `}
                  >
                    {k.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!lockedToEnv && hostKind === 'wsl' && (
            <div>
              <label className={labelCls}>WSL Distro</label>
              <input
                className={inputCls}
                value={distro}
                onChange={e => setDistro(e.target.value)}
                placeholder="Ubuntu"
              />
            </div>
          )}

          {!lockedToEnv && hostKind === 'ssh' && (
            <>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className={labelCls}>User</label>
                  <input className={inputCls} value={sshUser} onChange={e => setSshUser(e.target.value)} placeholder="root" />
                </div>
                <div className="flex-1">
                  <label className={labelCls}>Host</label>
                  <input className={inputCls} value={sshHost} onChange={e => setSshHost(e.target.value)} placeholder="1.2.3.4" />
                </div>
              </div>
              <div className="flex gap-2">
                <div className="w-24">
                  <label className={labelCls}>Port</label>
                  <input className={inputCls} value={sshPort} onChange={e => setSshPort(e.target.value)} placeholder="22" type="number" />
                </div>
                <div className="flex-1">
                  <label className={labelCls}>Key File (optional)</label>
                  <input className={inputCls} value={sshKeyFile} onChange={e => setSshKeyFile(e.target.value)} placeholder="~/.ssh/id_rsa" />
                </div>
              </div>
            </>
          )}

          <div>
            <label className={labelCls}>Project Path (on host)</label>
            <input className={inputCls} value={path} onChange={e => setPath(e.target.value)} placeholder="/home/user/myproject" />
          </div>

          <div>
            <label className={labelCls}>Model Override (optional)</label>
            <input className={inputCls} value={model} onChange={e => setModel(e.target.value)} placeholder="claude-opus-4-7" />
          </div>

          <button
            type="submit"
            disabled={!name.trim() || !path.trim()}
            className="w-full py-2 bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed rounded text-sm font-medium transition-colors"
          >
            {editProject ? 'Save Changes' : 'Add Project'}
          </button>
        </form>
      </>
    </Modal>
  )
}

// Reuse an existing environment if one already matches the entered host
// config (so the same WSL distro / SSH endpoint doesn't sprout duplicates),
// otherwise create a fresh one and persist it.
function findOrCreateEnvironment(
  envs: Environment[],
  host: HostType,
  addEnvironment: (env: Environment) => void
): Environment {
  const match = envs.find(e => sameHost(e.config, host))
  if (match) return match
  const created: Environment = {
    id: crypto.randomUUID(),
    name: defaultName(host),
    config: host
  }
  addEnvironment(created)
  return created
}

function sameHost(a: HostType, b: HostType): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'local' && b.kind === 'local') return true
  if (a.kind === 'wsl' && b.kind === 'wsl') return a.distro === b.distro
  if (a.kind === 'ssh' && b.kind === 'ssh') {
    return a.user === b.user && a.host === b.host && (a.port ?? 22) === (b.port ?? 22)
  }
  return false
}

function defaultName(host: HostType): string {
  if (host.kind === 'local') return 'Local'
  if (host.kind === 'wsl') return `WSL · ${host.distro}`
  return `SSH · ${host.user}@${host.host}`
}
