import type { HostType } from '../../shared/types'

// Defensive validation for SSH host config before we hand it to argv. Even
// though `spawn(bin, args, ...)` does not invoke a shell, ssh itself parses
// the host token: a value starting with `-` would be picked up as an option
// flag (e.g. `-oProxyCommand=...`), turning persisted config into a remote-
// code-execution surface. Whitespace / control chars in user@host land us in
// equally murky territory.
//
// Hostnames per RFC 952/1123 are alnum + dot + hyphen (no leading hyphen).
// SSH also accepts ssh_config Host aliases (any printable, no whitespace) and
// IPv6 in brackets. Use a permissive-but-safe set: printable ASCII excluding
// whitespace, with a leading-character exclusion for `-` and `=`.
const UNSAFE_LEADING = /^[-=]/
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\s\x00-\x1f\x7f]/

function safeArgvToken(value: string): boolean {
  if (!value.length) return false
  if (UNSAFE_LEADING.test(value)) return false
  if (UNSAFE_CHARS.test(value)) return false
  return true
}

export function validateSshHost(host: Extract<HostType, { kind: 'ssh' }>): void {
  if (!safeArgvToken(host.host)) {
    throw new Error(`Invalid SSH host: ${JSON.stringify(host.host)}`)
  }
  if (host.user !== undefined && host.user !== '' && !safeArgvToken(host.user)) {
    throw new Error(`Invalid SSH user: ${JSON.stringify(host.user)}`)
  }
  if (host.keyFile !== undefined && host.keyFile !== '' && UNSAFE_CHARS.test(host.keyFile)) {
    throw new Error(`Invalid SSH key file path: ${JSON.stringify(host.keyFile)}`)
  }
  if (host.port !== undefined && (!Number.isInteger(host.port) || host.port < 1 || host.port > 65535)) {
    throw new Error(`Invalid SSH port: ${JSON.stringify(host.port)}`)
  }
}

// Same set of constraints, surfaced for WSL distro names. wsl.exe takes the
// distro as its `-d` argument; a hyphen-leading distro name there would also
// be parsed as a flag.
export function validateWslDistro(distro: string): void {
  if (!safeArgvToken(distro)) {
    throw new Error(`Invalid WSL distro: ${JSON.stringify(distro)}`)
  }
}
