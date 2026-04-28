import type { HostType } from '../../shared/types'
import type { ITransport } from './types'
import { LocalTransport } from './local'
import { WslTransport } from './wsl'
import { SshTransport } from './ssh'

// Single resolver — both session-manager and ipc-handlers used to ship a
// near-identical copy of this. Drift between the two would be silent and
// only visible when adding a new HostType kind, so collapse here.
export function resolveTransport(host: HostType): ITransport {
  if (host.kind === 'local') return new LocalTransport()
  if (host.kind === 'wsl') return new WslTransport()
  if (host.kind === 'ssh') return new SshTransport()
  throw new Error(`Unknown host kind: ${(host as { kind: string }).kind}`)
}
