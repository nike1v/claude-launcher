// ClaudeProvider — claude-CLI lifecycle bound to the IProvider contract.
// Stateless: argv builder, env-scrub list, capabilities. The wire-format
// translator (parser + stdin formatters) lives in ClaudeAdapter, created
// per-session.

import type { HostType } from '../../../shared/types'
import type {
  EnvScrubPattern,
  IProvider,
  IProviderAdapter,
  ProviderCapabilities,
  SpawnOpts
} from '../types'
import { validateClaudeArg } from '../../transports/validate-path'
import { ClaudeAdapter } from './adapter'

const BASE_CLAUDE_ARGS = [
  '--output-format', 'stream-json',
  '--input-format', 'stream-json',
  '--verbose',
  '--permission-prompt-tool', 'stdio'
] as const

const CAPABILITIES: ProviderCapabilities = {
  resume: 'by-id',
  permissions: 'interactive',
  usage: 'available',
  sessionModelSwitch: 'in-session',
  transcripts: 'jsonl'
}

// Strip OAuth tokens belonging to *our* claude (the launcher app's own
// session) before they reach a remote / wsl child. The remote side has
// its own ~/.claude credentials and we don't want to clobber them with
// the host's. Exported so usage-probe.ts (which spawns claude in a PTY
// outside the IProvider flow) can apply the same list.
export const CLAUDE_ENV_SCRUB: readonly EnvScrubPattern[] = [
  { prefix: 'CLAUDE_CODE_' },
  { exact: 'CLAUDE_RPC_TOKEN' }
]

export class ClaudeProvider implements IProvider {
  public readonly kind = 'claude' as const
  public readonly label = 'Claude Code'
  public readonly capabilities = CAPABILITIES

  public buildSpawnArgs(opts: SpawnOpts): { bin: string; args: readonly string[] } {
    if (opts.model) validateClaudeArg(opts.model, 'model')
    if (opts.resumeRef) validateClaudeArg(opts.resumeRef, 'resumeSessionId')
    const args: string[] = [...BASE_CLAUDE_ARGS]
    if (opts.model) args.push('--model', opts.model)
    if (opts.resumeRef) args.push('--resume', opts.resumeRef)
    return { bin: 'claude', args }
  }

  public probeOptions(): { bin: string; versionLine: RegExp } {
    return { bin: 'claude', versionLine: /Claude Code/i }
  }

  public envScrubList(_host: HostType): readonly EnvScrubPattern[] {
    return CLAUDE_ENV_SCRUB
  }

  public createAdapter(): IProviderAdapter {
    return new ClaudeAdapter('live')
  }
}
