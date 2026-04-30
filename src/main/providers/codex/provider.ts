// CodexProvider — OpenAI Codex CLI lifecycle bound to the IProvider
// contract. Stateless metadata + argv builder; the JSON-RPC state
// machine lives in CodexAdapter.
//
// We spawn `codex app-server` (default --listen stdio://). All
// communication after that is JSON-RPC 2.0 over NDJSON on stdin/stdout.

import type { HostType } from '../../../shared/types'
import type {
  EnvScrubPattern,
  IProvider,
  IProviderAdapter,
  ProviderCapabilities,
  SpawnOpts
} from '../types'
import { CodexAdapter } from './adapter'

const CAPABILITIES: ProviderCapabilities = {
  resume: 'by-id',                  // thread/resume by threadId
  permissions: 'interactive',       // server-initiated approval requests
  usage: 'available',               // thread/tokenUsage/updated notifications
  sessionModelSwitch: 'unsupported', // model is set per turn at start
  transcripts: 'jsonl'              // rollouts persisted under $CODEX_HOME/sessions
}

// Strip OpenAI / codex auth tokens we have locally before they reach a
// remote child — the remote already has its own ~/.codex/auth.json or
// OPENAI_API_KEY set up by the user.
const CODEX_ENV_SCRUB: readonly EnvScrubPattern[] = [
  { exact: 'OPENAI_API_KEY' },
  { prefix: 'CODEX_HOME' },
  { prefix: 'OPENAI_' }
]

export class CodexProvider implements IProvider {
  public readonly kind = 'codex' as const
  public readonly label = 'OpenAI Codex'
  public readonly capabilities = CAPABILITIES

  public buildSpawnArgs(_opts: SpawnOpts): { bin: string; args: readonly string[] } {
    // No flags for the regular session-driver mode. Model / cwd / resume
    // all go through the JSON-RPC handshake the adapter drives.
    return { bin: 'codex', args: ['app-server'] }
  }

  public probeOptions(): { bin: string; versionLine: RegExp } {
    // `codex --version` prints something like "codex 0.x.y" — match
    // case-insensitively on the binary name.
    return { bin: 'codex', versionLine: /codex/i }
  }

  public envScrubList(_host: HostType): readonly EnvScrubPattern[] {
    return CODEX_ENV_SCRUB
  }

  public createAdapter(): IProviderAdapter {
    return new CodexAdapter('live')
  }
}
