import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Environment, HostType, Project } from '../../../../shared/types'
import type { ProviderKind } from '../../../../shared/events'
import { useProjectsStore } from '../../store/projects'
import { useEnvironmentsStore } from '../../store/environments'
import { Modal } from '../Modal'
import { PathCombobox } from '../Settings/PathCombobox'
import { EnvironmentStatus } from '../Settings/EnvironmentStatus'
import { findDuplicateEnvironment } from '../../lib/environment-dedup'
import { PROVIDER_OPTIONS, providerLabel, modelPlaceholderFor } from '../../lib/provider-options'
import { describeHost, transcriptDirHint } from '../../../../shared/host-utils'
import { listSessionIds } from '../../ipc/bridge'

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
  // Per-project provider override. `undefined` means "inherit from the
  // environment" (falls back to env.providerKind ?? 'claude' in
  // session-manager via resolveProviderKind). When set, this project
  // spawns the picked provider's binary instead of whatever the env
  // defaults to — letting users run claude / codex / cursor / opencode
  // side-by-side under the same connection.
  const [providerKind, setProviderKind] = useState<ProviderKind | undefined>(editProject?.providerKind)
  const inheritedProvider: ProviderKind = editEnv?.providerKind ?? 'claude'

  // Edit-only field: the provider session id we pass as the resume
  // reference next time this project is opened. Auto-pinned by
  // listeners.ts on the first session.started, but exposed here so the
  // user can paste a different one from the on-disk transcript directory.
  const [claudeSessionId, setClaudeSessionId] = useState(editProject?.lastSessionRef ?? '')
  // Tracked so the save guard below can tell "user cleared a previously-
  // pinned id" apart from "no id was pinned at form open". Snapshot at
  // construction so subsequent edits don't move the goalposts.
  const hadInitialSessionId = !!editProject?.lastSessionRef
  const clearedSessionId = hadInitialSessionId && !claudeSessionId.trim()
  // Available session ids for autocomplete + soft validation. null while
  // we haven't asked yet (so we don't flag a typed id as "missing"
  // before the list arrives); empty array means we asked but found
  // nothing (fresh project, unreachable env, etc.) — also no warning,
  // just no suggestions.
  const [availableIds, setAvailableIds] = useState<string[] | null>(null)
  useEffect(() => {
    if (!editProject) return
    let cancelled = false
    listSessionIds(editProject.id).then(ids => {
      if (!cancelled) setAvailableIds(ids)
    }).catch(() => {
      if (!cancelled) setAvailableIds([])
    })
    return () => { cancelled = true }
  }, [editProject?.id])
  // Soft warning: typed id isn't in the listed transcripts. Doesn't
  // block save — we trust the user (the ls might've failed, or they
  // pasted from a transcript not yet flushed to disk).
  const trimmedId = claudeSessionId.trim()
  const idNotFound = !!trimmedId
    && availableIds !== null
    && availableIds.length > 0
    && !availableIds.includes(trimmedId)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !path.trim()) return
    // Mirror the disabled-button guard for keyboard submits — Enter inside
    // any input bypasses the button's disabled attribute.
    if (clearedSessionId) return

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

    // The picker is locked when there's a saved session, so by here
    // either (a) provider hasn't changed, or (b) there was nothing to
    // invalidate. Plain forward of trimmed ref + cached metadata.
    const project: Project = {
      id: editProject?.id ?? crypto.randomUUID(),
      name: name.trim(),
      environmentId: envId,
      path: path.trim(),
      model: model.trim() || undefined,
      providerKind,
      lastSessionRef: claudeSessionId.trim() || undefined,
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

          {editEnv && (
            <div>
              <label className={labelCls}>Provider Override (optional)</label>
              {/* Lock the picker when the project has a saved session.
                  Cross-provider session refs aren't interchangeable
                  (claude UUIDs, codex `thr_*`, ACP `sess_*`), and
                  silently dropping the pin when the user switches
                  providers means losing in-flight context. Direct the
                  user to the reset-conversation button on the project
                  row instead — it confirms the destruction explicitly,
                  closes any open tab, and unpins the saved session so
                  the picker unlocks. */}
              {editProject && hadInitialSessionId ? (
                <>
                  <div className="px-3 py-2 rounded border border-divider bg-elevated text-xs text-fg-muted">
                    {providerLabel(providerKind ?? inheritedProvider)}
                    {providerKind === undefined && (
                      <span className="text-fg-faint"> (inherited from {editEnv.name})</span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-fg-faint break-words">
                    Locked while this project has a saved conversation. Use the reset-conversation button (
                    <span className="font-mono">↻</span>
                    ) on the project row to clear the pinned session, then re-open this dialog to switch providers.
                  </p>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-5 gap-1">
                    <button
                      type="button"
                      onClick={() => setProviderKind(undefined)}
                      className={`py-1.5 text-[10px] rounded border transition-colors
                        ${providerKind === undefined
                          ? 'bg-elevated border-divider-strong text-fg'
                          : 'border-divider text-fg-faint hover:border-divider-strong'}
                      `}
                      title={`Inherit ${providerLabel(inheritedProvider)} from ${editEnv.name}`}
                    >
                      Inherit
                    </button>
                    {PROVIDER_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setProviderKind(opt.value)}
                        className={`py-1.5 text-[10px] rounded border transition-colors truncate
                          ${providerKind === opt.value
                            ? 'bg-elevated border-divider-strong text-fg'
                            : 'border-divider text-fg-faint hover:border-divider-strong'}
                        `}
                        title={`${opt.label} (${opt.bin})`}
                      >
                        {opt.label.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                  {providerKind === undefined ? (
                    <p className="mt-1 text-[10px] text-fg-faint">
                      Inherits {providerLabel(inheritedProvider)} from <span className="text-fg-muted">{editEnv.name}</span>. Override to run a different CLI for this project under the same environment.
                    </p>
                  ) : (
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="text-[10px] text-fg-faint">
                        Spawns <span className="font-mono">{PROVIDER_OPTIONS.find(o => o.value === providerKind)?.bin}</span> on this env instead of {providerLabel(inheritedProvider)}.
                      </p>
                      <EnvironmentStatus
                        config={editEnv.config}
                        providerKind={providerKind}
                        compact
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div>
            <label className={labelCls}>
              {providerLabel(providerKind ?? inheritedProvider)} model override (optional)
            </label>
            <input
              className={inputCls}
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder={editEnv?.defaultModel || modelPlaceholderFor(providerKind ?? inheritedProvider)}
            />
            {editEnv?.defaultModel && !model && (
              <p className="mt-1 text-[10px] text-fg-faint">
                Inherits "{editEnv.defaultModel}" from {editEnv.name}.
              </p>
            )}
          </div>

          {/* Session id is editable only when editing an existing project,
              and only for providers we can actually enumerate
              transcripts for. claude has on-disk JSONL we list via
              fs:listSessionIds. codex / cursor / opencode either don't
              expose transcripts or store them in formats we don't read
              yet — for those, we still surface the pinned id (so the
              user sees what's persisted) but skip the autocomplete +
              transcript-dir hint to avoid claiming behaviour that
              isn't there. */}
          {editProject && editEnv && (() => {
            const resolvedProvider = providerKind ?? inheritedProvider
            const supportsTranscriptList = resolvedProvider === 'claude'
            return (
              <div>
                <label className={labelCls}>
                  {providerLabel(resolvedProvider)} session id (resume target, optional)
                </label>
                <input
                  list={supportsTranscriptList ? `session-ids-${editProject.id}` : undefined}
                  className={`${inputCls} ${
                    clearedSessionId
                      ? 'border-danger/40'
                      : idNotFound && supportsTranscriptList
                      ? 'border-warn/40'
                      : ''
                  }`}
                  value={claudeSessionId}
                  onChange={e => setClaudeSessionId(e.target.value)}
                  placeholder={hadInitialSessionId ? '' : 'auto-pinned on first session'}
                  spellCheck={false}
                />
                {/* Native autocomplete from claude's on-disk transcripts.
                    Other providers don't have an equivalent listing
                    (codex sessions aren't indexed yet; ACP keeps state
                    inside the agent). */}
                {supportsTranscriptList && availableIds && availableIds.length > 0 && (
                  <datalist id={`session-ids-${editProject.id}`}>
                    {availableIds.map(id => <option key={id} value={id} />)}
                  </datalist>
                )}
                {clearedSessionId ? (
                  <p className="mt-1 text-[10px] text-danger break-words">
                    Use the reset-conversation button on the project row to
                    clear this — it also closes any open tab and confirms
                    before unpinning. Saving now would silently lose the
                    pinned id.
                  </p>
                ) : !supportsTranscriptList ? (
                  <p className="mt-1 text-[10px] text-fg-faint break-words">
                    {providerLabel(resolvedProvider)} keeps session state inside the agent —
                    we can't list pinned conversations from disk. The id is auto-pinned on
                    first session and used as the resume target on next open.
                  </p>
                ) : idNotFound ? (
                  <p className="mt-1 text-[10px] text-warn break-words">
                    No transcript with this id found in <span className="font-mono">{transcriptDirHint(editEnv.config, path.trim() || editProject.path)}</span>. Saving anyway will let you resume only if claude can find it.
                  </p>
                ) : (
                  <p className="mt-1 text-[10px] text-fg-faint break-words">
                    {availableIds === null
                      ? 'Loading saved conversations…'
                      : availableIds.length === 0
                      ? <>No saved conversations yet at <span className="font-mono text-fg-muted">{transcriptDirHint(editEnv.config, path.trim() || editProject.path)}</span> — the field will auto-fill on the first session.</>
                      : <>{availableIds.length} saved conversation{availableIds.length === 1 ? '' : 's'} available — pick from the dropdown or paste a <span className="font-mono">…jsonl</span> filename without the extension.</>}
                  </p>
                )}
              </div>
            )
          })()}

          <button
            type="submit"
            disabled={!name.trim() || !path.trim() || clearedSessionId}
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

