import type { ChildProcess } from 'node:child_process'
import type { HostType } from '../../shared/types'

export interface SpawnOptions {
  host: HostType
  path: string
  model?: string
  resumeSessionId?: string
}

export type ProbeResult = { ok: true; version: string } | { ok: false; reason: string }

export interface ITransport {
  spawn(options: SpawnOptions): ChildProcess
  // Async pre-flight: run `claude --version` over this transport. The
  // session-manager runs it before starting a session, and the renderer
  // calls it from the Settings modal to show env health.
  probe(host: HostType): Promise<ProbeResult>
}
