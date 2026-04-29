import type { HostType } from '../../shared/types'

// SSH spawn args were copy-pasted across transport.spawn(), transport.probe(),
// dir-lister, history-reader, and usage-probe — five sites, all building
// `[-T, -p, ?, -i, ?, target]` from the same Host fields. Centralised here.

export function sshConnectArgs(host: Extract<HostType, { kind: 'ssh' }>): string[] {
  const args: string[] = []
  if (host.port) args.push('-p', String(host.port))
  if (host.keyFile) args.push('-i', host.keyFile)
  return args
}

// `ssh user@host` when user is set; bare `ssh host` otherwise so OpenSSH
// looks up the Host alias in ~/.ssh/config and pulls user/port/key from
// there.
export function sshTarget(host: Extract<HostType, { kind: 'ssh' }>): string {
  return host.user ? `${host.user}@${host.host}` : host.host
}
