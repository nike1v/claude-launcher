// CursorProvider — Cursor's AI agent CLI bound to the IProvider
// contract via ACP (Agent Client Protocol). Spawns `cursor agent acp`,
// the protocol logic lives in AcpAdapter (shared with opencode).

import type { HostType } from '../../../shared/types'
import type {
  EnvScrubPattern,
  IProvider,
  IProviderAdapter,
  ProviderCapabilities,
  SpawnOpts
} from '../types'
import { AcpAdapter } from '../acp/adapter'

const CAPABILITIES: ProviderCapabilities = {
  resume: 'by-id',                  // session/load by sessionId
  permissions: 'interactive',       // session/request_permission flow
  usage: 'none',                    // cursor doesn't surface token usage in ACP
  sessionModelSwitch: 'in-session', // session/set_config_option model
  // Cursor stores transcripts at ~/.cursor/agent/sessions/<id>/
  // but the format isn't protocol-stable. We don't replay them today.
  transcripts: 'none'
}

const CURSOR_ENV_SCRUB: readonly EnvScrubPattern[] = [
  { exact: 'CURSOR_API_KEY' },
  { exact: 'CURSOR_AUTH_TOKEN' },
  { prefix: 'CURSOR_' }
]

export class CursorProvider implements IProvider {
  public readonly kind = 'cursor' as const
  public readonly label = 'Cursor Agent'
  public readonly capabilities = CAPABILITIES

  public buildSpawnArgs(_opts: SpawnOpts): { bin: string; args: readonly string[] } {
    // Cursor's CLI binary registers as `agent` after `curl
    // https://cursor.com/install -fsS | bash`. `cursor-agent` is an
    // alias on some installs; sticking to `agent` matches the
    // documented invocation. Model + cwd + resume go through the
    // ACP handshake the adapter drives.
    return { bin: 'agent', args: ['acp'] }
  }

  public probeOptions(): { bin: string; versionLine: RegExp } {
    return { bin: 'agent', versionLine: /cursor|agent/i }
  }

  public envScrubList(_host: HostType): readonly EnvScrubPattern[] {
    return CURSOR_ENV_SCRUB
  }

  public createAdapter(): IProviderAdapter {
    return new AcpAdapter('cursor', 'live')
  }
}
