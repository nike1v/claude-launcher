import type {ChildProcess} from 'node:child_process'
import type {HostType} from '../../shared/types'

export interface SpawnOptions {
  host: HostType
  path: string
  model?: string
  resumeSessionId?: string
}

export type ProbeResult = { ok: true; version: string } | { ok: false; reason: string }

export interface ITransport {
  spawn(options: SpawnOptions): ChildProcess
  // Optional: cheap pre-flight that runs `claude --version` so we fail fast
  // when the binary is missing or isn't the Claude Code CLI.
  probe?(): ProbeResult
}
