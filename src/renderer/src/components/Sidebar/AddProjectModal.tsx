import { useState } from 'react'
import { X } from 'lucide-react'
import type { Project, HostType } from '../../../../shared/types'
import { useProjectsStore } from '../../store/projects'

interface Props {
  onClose: () => void
  editProject?: Project
}

export function AddProjectModal({ onClose, editProject }: Props): JSX.Element {
  const { addProject, updateProject } = useProjectsStore()

  const [name, setName] = useState(editProject?.name ?? '')
  const [path, setPath] = useState(editProject?.path ?? '')
  const [model, setModel] = useState(editProject?.model ?? '')
  const [hostKind, setHostKind] = useState<'wsl' | 'ssh'>(
    editProject?.host.kind ?? 'wsl'
  )
  const [distro, setDistro] = useState(
    editProject?.host.kind === 'wsl' ? editProject.host.distro : 'Ubuntu'
  )
  const [sshUser, setSshUser] = useState(
    editProject?.host.kind === 'ssh' ? editProject.host.user : ''
  )
  const [sshHost, setSshHost] = useState(
    editProject?.host.kind === 'ssh' ? editProject.host.host : ''
  )
  const [sshPort, setSshPort] = useState(
    editProject?.host.kind === 'ssh' ? String(editProject.host.port ?? '') : ''
  )
  const [sshKeyFile, setSshKeyFile] = useState(
    editProject?.host.kind === 'ssh' ? (editProject.host.keyFile ?? '') : ''
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !path.trim()) return

    const host: HostType =
      hostKind === 'wsl'
        ? { kind: 'wsl', distro: distro.trim() }
        : {
            kind: 'ssh',
            user: sshUser.trim(),
            host: sshHost.trim(),
            port: sshPort ? Number(sshPort) : undefined,
            keyFile: sshKeyFile.trim() || undefined
          }

    const project: Project = {
      id: editProject?.id ?? crypto.randomUUID(),
      name: name.trim(),
      host,
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[#1a1a1a] border border-white/10 rounded-lg p-5 w-96 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">{editProject ? 'Edit Project' : 'Add Project'}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelCls}>Name</label>
            <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="My Project" />
          </div>

          <div>
            <label className={labelCls}>Host Type</label>
            <div className="flex gap-2">
              {(['wsl', 'ssh'] as const).map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setHostKind(k)}
                  className={`flex-1 py-1.5 text-xs rounded border transition-colors
                    ${hostKind === k
                      ? 'bg-white/10 border-white/30 text-white'
                      : 'border-white/10 text-white/40 hover:border-white/20'
                    }`}
                >
                  {k.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {hostKind === 'wsl' && (
            <div>
              <label className={labelCls}>WSL Distro</label>
              <input className={inputCls} value={distro} onChange={e => setDistro(e.target.value)} placeholder="Ubuntu" />
            </div>
          )}

          {hostKind === 'ssh' && (
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
      </div>
    </div>
  )
}
