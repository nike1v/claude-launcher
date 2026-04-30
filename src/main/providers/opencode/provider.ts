// OpencodeProvider — sst/opencode CLI bound to the IProvider contract
// via ACP. Spawns `opencode acp`, the protocol logic lives in
// AcpAdapter (shared with cursor).
//
// Auth note: opencode treats authenticate() as a pass-through — the
// real authentication is configured outside the protocol via
// `opencode auth login` (writes ~/.config/opencode/auth.json) or env
// vars for whichever underlying LLM provider opencode is configured
// to talk to. The launcher just spawns the binary; if opencode
// can't reach its provider, the first session/prompt errors and we
// surface that.

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
  permissions: 'interactive',       // session/request_permission
  usage: 'available',               // session/update sessionUpdate=usage_update
  sessionModelSwitch: 'unsupported', // model is whatever opencode auth was configured with
  // Opencode persists sessions in SQLite under
  // ~/.local/share/opencode/storage/ but the format is internal —
  // backfill would have to go through opencode's HTTP API.
  transcripts: 'none'
}

const OPENCODE_ENV_SCRUB: readonly EnvScrubPattern[] = [
  { prefix: 'OPENCODE_' },
  { exact: 'OPENAI_API_KEY' },
  { exact: 'ANTHROPIC_API_KEY' },
  { exact: 'GROQ_API_KEY' }
]

export class OpencodeProvider implements IProvider {
  public readonly kind = 'opencode' as const
  public readonly label = 'opencode'
  public readonly capabilities = CAPABILITIES

  public buildSpawnArgs(opts: SpawnOpts): { bin: string; args: readonly string[] } {
    const args: string[] = ['acp']
    // opencode's `acp` subcommand accepts --cwd; passing it lets the
    // ACP server know the project root before session/new sets it
    // again. Belt + suspenders.
    if (opts.cwd) args.push('--cwd', opts.cwd)
    return { bin: 'opencode', args }
  }

  public probeOptions(): { bin: string; versionLine: RegExp } {
    return { bin: 'opencode', versionLine: /opencode/i }
  }

  public envScrubList(_host: HostType): readonly EnvScrubPattern[] {
    return OPENCODE_ENV_SCRUB
  }

  public createAdapter(): IProviderAdapter {
    return new AcpAdapter('opencode', 'live')
  }
}
