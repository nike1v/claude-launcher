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

export interface ITransport {
  spawn(options: SpawnOptions): ChildProcess
  // Async pre-flight: run `<provider-binary> --version` over this
  // transport. Today every provider is claude, so transports run the
  // claude version check directly. When codex / cursor land we'll
  // generalize the probe so providers supply their own bash payload +
  // version-line matcher (see docs/providers.md).
  probe(host: HostType): Promise<ProbeResult>
}
