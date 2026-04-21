import type {ChildProcess} from 'node:child_process'
import type {HostType} from '../../shared/types'

export interface SpawnOptions {
  host: HostType
  path: string
  model?: string
  resumeSessionId?: string
}

export interface ITransport {
  spawn(options: SpawnOptions): ChildProcess
}
