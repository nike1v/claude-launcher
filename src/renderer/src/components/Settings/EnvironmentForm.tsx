import { useMemo, useState } from 'react'
import type { Environment, HostType } from '../../../../shared/types'
import type { ProviderKind } from '../../../../shared/events'
import { useEnvironmentsStore } from '../../store/environments'
import { findDuplicateEnvironment } from '../../lib/environment-dedup'
import { EnvironmentStatus, type ProbeState } from './EnvironmentStatus'
import { ModelCombobox } from './ModelCombobox'

const PROVIDER_OPTIONS: ReadonlyArray<{ value: ProviderKind; label: string; bin: string }> = [
  { value: 'claude', label: 'Claude Code', bin: 'claude' },
  { value: 'codex', label: 'OpenAI Codex', bin: 'codex' }
]

interface Props {
  initial: Environment | null
  onCancel: () => void
  onSave: (env: Environment) => void
}

const HOST_KINDS: ReadonlyArray<'local' | 'wsl' | 'ssh'> =
  window.electronAPI.platform === 'win32'
    ? ['local', 'wsl', 'ssh']
    : ['local', 'ssh']

export function EnvironmentForm({ initial, onCancel, onSave }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState<'local' | 'wsl' | 'ssh'>(initial?.config.kind ?? 'local')
  const [distro, setDistro] = useState(
    initial?.config.kind === 'wsl' ? initial.config.distro : 'Ubuntu'
  )
  const [sshUser, setSshUser] = useState(
    initial?.config.kind === 'ssh' ? (initial.config.user ?? '') : ''
  )
  const [sshHost, setSshHost] = useState(
    initial?.config.kind === 'ssh' ? initial.config.host : ''
  )
  const [sshPort, setSshPort] = useState(
    initial?.config.kind === 'ssh' ? String(initial.config.port ?? '') : ''
  )
  const [sshKeyFile, setSshKeyFile] = useState(
    initial?.config.kind === 'ssh' ? (initial.config.keyFile ?? '') : ''
  )
  const [defaultModel, setDefaultModel] = useState(initial?.defaultModel ?? '')
  const [providerKind, setProviderKind] = useState<ProviderKind>(initial?.providerKind ?? 'claude')
  const [probeState, setProbeState] = useState<ProbeState>({ kind: 'idle' })
  const { environments } = useEnvironmentsStore()

  // Snapshot of the host config the form currently describes — used to drive
  // the live probe. Memoised so identical edits don't re-fire the probe each
  // render (the EnvironmentStatus rev key handles deliberate re-checks).
  const probeConfig = useMemo<HostType | null>(() => {
    if (kind === 'local') return { kind: 'local' }
    if (kind === 'wsl') return distro.trim() ? { kind: 'wsl', distro: distro.trim() } : null
    if (!sshHost.trim()) return null
    return {
      kind: 'ssh',
      user: sshUser.trim() || undefined,
      host: sshHost.trim(),
      port: sshPort ? Number(sshPort) : undefined,
      keyFile: sshKeyFile.trim() || undefined
    }
  }, [kind, distro, sshUser, sshHost, sshPort, sshKeyFile])

  // Block saves that would duplicate an existing environment. Local can only
  // exist once; WSL is per-distro; SSH dedupes on user@host (port ignored).
  const duplicate = useMemo(() => {
    if (!probeConfig) return null
    return findDuplicateEnvironment(environments, probeConfig, initial?.id)
  }, [environments, probeConfig, initial?.id])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (duplicate) return
    const config: HostType =
      kind === 'local'
        ? { kind: 'local' }
        : kind === 'wsl'
        ? { kind: 'wsl', distro: distro.trim() }
        : {
            kind: 'ssh',
            user: sshUser.trim() || undefined,
            host: sshHost.trim(),
            port: sshPort ? Number(sshPort) : undefined,
            keyFile: sshKeyFile.trim() || undefined
          }

    if (kind === 'wsl' && !distro.trim()) return
    // Host is required; user is optional — empty user means "use whatever
    // ~/.ssh/config says for this host alias".
    if (kind === 'ssh' && !sshHost.trim()) return
    if (!name.trim()) return

    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      config,
      defaultModel: defaultModel.trim() || undefined,
      providerKind
    })
  }

  const inputCls = 'w-full bg-elevated border border-divider rounded px-2 py-1.5 text-sm text-fg placeholder-fg-faint focus:outline-none focus:border-accent'
  const labelCls = 'block text-xs text-fg-faint mb-1'

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className={labelCls}>Name</label>
        <input
          className={inputCls}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={kind === 'local' ? 'Local' : kind === 'wsl' ? 'WSL · Ubuntu' : 'SSH · server'}
          autoFocus
        />
      </div>

      <div>
        <label className={labelCls}>Type</label>
        <div className="flex gap-2">
          {HOST_KINDS.map(k => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              disabled={!!initial}
              className={`flex-1 py-1.5 text-xs rounded border transition-colors
                ${kind === k
                  ? 'bg-elevated border-divider-strong text-fg'
                  : 'border-divider text-fg-faint hover:border-divider-strong'}
                ${initial ? 'opacity-60 cursor-not-allowed hover:border-divider' : ''}
              `}
            >
              {k.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {kind === 'wsl' && (
        <div>
          <label className={labelCls}>WSL Distro</label>
          <input className={inputCls} value={distro} onChange={e => setDistro(e.target.value)} placeholder="Ubuntu" />
        </div>
      )}

      {kind === 'ssh' && (
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
                placeholder="leave empty to use ~/.ssh/config"
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
          <p className="text-[10px] text-fg-faint -mt-1">
            Tip: leave User / Port / Key File empty if the host is defined in <span className="font-mono">~/.ssh/config</span>.
          </p>
        </>
      )}

      <div>
        <label className={labelCls}>Provider</label>
        <div className="flex gap-2">
          {PROVIDER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setProviderKind(opt.value)}
              className={`flex-1 py-1.5 text-xs rounded border transition-colors
                ${providerKind === opt.value
                  ? 'bg-elevated border-divider-strong text-fg'
                  : 'border-divider text-fg-faint hover:border-divider-strong'}
              `}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-fg-faint">
          The CLI to spawn — its binary (<span className="font-mono">
            {PROVIDER_OPTIONS.find(o => o.value === providerKind)?.bin}
          </span>) must be on the env's PATH.
        </p>
      </div>

      <div>
        <label className={labelCls}>Default Model (optional)</label>
        <ModelCombobox value={defaultModel} onChange={setDefaultModel} placeholder="claude-opus-4-7" />
        <p className="mt-1 text-[10px] text-fg-faint">
          Projects under this environment use this unless they set their own model.
        </p>
      </div>

      {probeConfig && (
        <div className="flex items-center justify-between rounded border border-divider bg-elevated px-3 py-2">
          <span className="text-xs text-fg-faint">Connection</span>
          <EnvironmentStatus config={probeConfig} providerKind={providerKind} onResult={setProbeState} />
        </div>
      )}

      {(() => {
        const blocked = !probeConfig || probeState.kind !== 'ok' || !!duplicate
        const reason = duplicate
          ? `Already exists as "${duplicate.name}".`
          : !probeConfig ? 'Fill the connection details to test.'
          : probeState.kind === 'checking' ? 'Checking the connection…'
          : probeState.kind === 'error' ? 'The selected provider CLI must be reachable on this connection before it can be saved.'
          : ''
        return (
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 py-2 text-xs font-medium rounded border border-divider text-fg-muted hover:text-fg hover:border-divider-strong transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={blocked}
                title={blocked ? reason : undefined}
                className="flex-1 py-2 text-xs font-medium rounded bg-elevated hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {initial ? 'Save' : 'Add Environment'}
              </button>
            </div>
            {blocked && reason && (
              <p className="text-[10px] text-fg-faint text-right">{reason}</p>
            )}
          </div>
        )
      })()}
    </form>
  )
}
