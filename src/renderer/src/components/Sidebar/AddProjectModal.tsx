import { useState } from 'react'
import { X } from 'lucide-react'
import type { Environment, HostType, Project } from '../../../../shared/types'
import { useProjectsStore } from '../../store/projects'
import { useEnvironmentsStore } from '../../store/environments'
import { Modal } from '../Modal'
import { ModelCombobox } from '../Settings/ModelCombobox'
import { PathCombobox } from '../Settings/PathCombobox'
import { findDuplicateEnvironment } from '../../lib/environment-dedup'
import { describeHost, transcriptDirHint } from '../../../../shared/host-utils'

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
export function AddProjectModal({ onClose, editProject, presetEnvironmentId }: Props) {
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
    editEnv?.config.kind === 'ssh' ? (editEnv.config.user ?? '') : ''
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
  // Edit-only field: the claudeSessionId we pass as `--resume` next time
  // this project is opened. Auto-pinned by listeners.ts on the first
  // system:init, but exposed here so the user can paste a different one
  // from the on-disk transcript directory.
  const [claudeSessionId, setClaudeSessionId] = useState(editProject?.lastClaudeSessionId ?? '')

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
              user: sshUser.trim() || undefined,
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
      model: model.trim() || undefined,
      // Carry the manually-edited session id through. Empty string maps
      // to undefined so the listener's write-once pin re-fires on the
      // next session start. lastModel / lastContextWindow are
      // intentionally NOT touched here — they're auto-managed and
      // would be confusing to expose for direct editing.
      lastClaudeSessionId: claudeSessionId.trim() || undefined,
      lastModel: editProject?.lastModel,
      lastContextWindow: editProject?.lastContextWindow
    }

    if (editProject) updateProject(project)
    else addProject(project)
    onClose()
  }

  const inputCls = 'w-full bg-elevated border border-divider rounded px-2 py-1.5 text-sm text-fg placeholder-fg-faint focus:outline-none focus:border-accent'
  const labelCls = 'block text-xs text-fg-faint mb-1'

  return (
    <Modal onClose={onClose} panelClassName="bg-panel border border-divider rounded-lg p-5 w-96 max-h-[90vh] overflow-y-auto">
      <>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">{editProject ? 'Edit Project' : 'Add Project'}</h2>
          <button onClick={onClose} className="text-fg-faint hover:text-fg"><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelCls}>Name</label>
            <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="My Project" />
          </div>

          {lockedToEnv && editEnv ? (
            <div>
              <label className={labelCls}>Environment</label>
              <div className="text-xs text-fg-muted px-2 py-1.5 rounded bg-elevated border border-divider">
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
                        ? 'bg-elevated border-divider-strong text-fg'
                        : 'border-divider text-fg-faint hover:border-divider-strong'}
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
                  <label className={labelCls}>Host or alias</label>
                  <input
                    className={inputCls}
                    value={sshHost}
                    onChange={e => setSshHost(e.target.value)}
                    placeholder="hetzner  ·  or  1.2.3.4"
                  />
                </div>
                <div className="flex-1">
                  <label className={labelCls}>User (optional)</label>
                  <input
                    className={inputCls}
                    value={sshUser}
                    onChange={e => setSshUser(e.target.value)}
                    placeholder="leave empty for ~/.ssh/config"
                  />
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
            {/* The combobox wants a stable HostType so it can list dirs over
                the right transport. We have one whenever the project is
                bound to an existing env (edit / preset); for the legacy
                host-fields flow there's no probe target yet. */}
            {editEnv ? (
              <PathCombobox
                value={path}
                onChange={setPath}
                config={editEnv.config}
                placeholder="/home/user/myproject"
              />
            ) : (
              <input
                className={inputCls}
                value={path}
                onChange={e => setPath(e.target.value)}
                placeholder="/home/user/myproject"
              />
            )}
          </div>

          <div>
            <label className={labelCls}>Model Override (optional)</label>
            <ModelCombobox
              value={model}
              onChange={setModel}
              placeholder={editEnv?.defaultModel || 'claude-opus-4-7'}
            />
            {editEnv?.defaultModel && !model && (
              <p className="mt-1 text-[10px] text-fg-faint">
                Inherits "{editEnv.defaultModel}" from {editEnv.name}.
              </p>
            )}
          </div>

          {/* Session id is editable only when editing an existing project —
              for fresh projects there's nothing to pin yet, the listener
              will write the id on first system:init. The helper text shows
              the on-disk transcripts dir for the current env so the user
              knows where to look if they want to paste a different id. */}
          {editProject && editEnv && (
            <div>
              <label className={labelCls}>
                Claude Session ID (resume target, optional)
              </label>
              <input
                className={inputCls}
                value={claudeSessionId}
                onChange={e => setClaudeSessionId(e.target.value)}
                placeholder="auto-pinned on first session"
                spellCheck={false}
              />
              <p className="mt-1 text-[10px] text-fg-faint break-words">
                Transcripts live in <span className="font-mono text-fg-muted">{transcriptDirHint(editEnv.config, path.trim() || editProject.path)}</span> — paste a <span className="font-mono">…jsonl</span> filename (without extension) to resume that conversation. Leave empty to start fresh next time; the field auto-fills when claude reports its session id.
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={!name.trim() || !path.trim()}
            className="w-full py-2 bg-elevated hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed rounded text-sm font-medium transition-colors"
          >
            {editProject ? 'Save Changes' : 'Add Project'}
          </button>
        </form>
      </>
    </Modal>
  )
}

// Reuse an existing environment if one already targets the same connection
// (so the legacy "Add Project" flow doesn't sprout duplicates when the user
// re-types config that already has a matching env). Falls back to creating
// a fresh one. Dedupe rules are shared with EnvironmentForm.
function findOrCreateEnvironment(
  envs: Environment[],
  host: HostType,
  addEnvironment: (env: Environment) => void
): Environment {
  const match = findDuplicateEnvironment(envs, host)
  if (match) return match
  const created: Environment = {
    id: crypto.randomUUID(),
    name: describeHost(host),
    config: host
  }
  addEnvironment(created)
  return created
}

