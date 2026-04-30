import type { ChildProcess } from 'node:child_process'
import type { HostType } from '../../shared/types'
import type { EnvScrubPattern } from '../providers/types'

export interface SpawnOptions {
  host: HostType
  // Working directory the child runs in. For wsl/ssh, transports
  // emit `--cd <path>` / `cd <path> && exec <bin>` respectively.
  path: string
  // Provider-resolved binary name and argv. Transports don't know what
  // CLI they're spawning — they just wrap (bin, args) in their host
  // shell convention.
  bin: string
  args: readonly string[]
  // Env vars to strip from the inherited environment before spawn,
  // discriminated by `prefix` vs `exact`.
  envScrubKeys?: readonly EnvScrubPattern[]
}

export type ProbeResult = { ok: true; version: string } | { ok: false; reason: string }

// Provider-supplied probe parameters. The transport runs `<bin>
// --version` over its host wrapper (or `bash -lc 'probeScript(bin)'`
// for wsl / ssh) and checks each output line against `versionLine` to
// confirm the right CLI was on PATH. Without the regex check we'd
// happily accept any binary that exits 0, including a stub `claude`
// shell function or a wrapper that stalls.
export interface ProbeOptions {
  bin: string
  versionLine: RegExp
}

export interface ITransport {
  spawn(options: SpawnOptions): ChildProcess
  // Async pre-flight: run the provider's version check over this
  // transport. Caller supplies the binary name + version-line regex
  // via ProbeOptions; the transport handles host wrapping (wsl.exe,
  // ssh, login-shell PATH cache).
  probe(host: HostType, opts: ProbeOptions): Promise<ProbeResult>
}
