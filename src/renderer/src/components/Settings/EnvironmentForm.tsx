import { useMemo, useState } from 'react'
import type { Environment, HostType } from '../../../../shared/types'
import { EnvironmentStatus } from './EnvironmentStatus'
import { ModelCombobox } from './ModelCombobox'

interface Props {
  initial: Environment | null
  onCancel: () => void
  onSave: (env: Environment) => void
}

const HOST_KINDS: ReadonlyArray<'local' | 'wsl' | 'ssh'> =
  window.electronAPI.platform === 'win32'
    ? ['local', 'wsl', 'ssh']
    : ['local', 'ssh']

export function EnvironmentForm({ initial, onCancel, onSave }: Props): JSX.Element {
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState<'local' | 'wsl' | 'ssh'>(initial?.config.kind ?? 'local')
  const [distro, setDistro] = useState(
    initial?.config.kind === 'wsl' ? initial.config.distro : 'Ubuntu'
  )
  const [sshUser, setSshUser] = useState(
    initial?.config.kind === 'ssh' ? initial.config.user : ''
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
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
      defaultModel: defaultModel.trim() || undefined
    })
  }

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30'
  const labelCls = 'block text-xs text-white/50 mb-1'

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
                  ? 'bg-white/10 border-white/30 text-white'
                  : 'border-white/10 text-white/40 hover:border-white/20'}
                ${initial ? 'opacity-60 cursor-not-allowed hover:border-white/10' : ''}
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
          <p className="text-[10px] text-white/40 -mt-1">
            Tip: leave User / Port / Key File empty if the host is defined in <span className="font-mono">~/.ssh/config</span>.
          </p>
        </>
      )}

      <div>
        <label className={labelCls}>Default Model (optional)</label>
        <ModelCombobox value={defaultModel} onChange={setDefaultModel} placeholder="claude-opus-4-7" />
        <p className="mt-1 text-[10px] text-white/30">
          Projects under this environment use this unless they set their own model.
        </p>
      </div>

      {probeConfig && (
        <div className="flex items-center justify-between rounded border border-white/10 bg-white/[0.02] px-3 py-2">
          <span className="text-xs text-white/50">Connection</span>
          <EnvironmentStatus config={probeConfig} />
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2 text-xs font-medium rounded border border-white/10 text-white/60 hover:text-white hover:border-white/20 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="flex-1 py-2 text-xs font-medium rounded bg-white/10 hover:bg-white/15 transition-colors"
        >
          {initial ? 'Save' : 'Add Environment'}
        </button>
      </div>
    </form>
  )
}
