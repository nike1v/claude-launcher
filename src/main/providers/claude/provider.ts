// ClaudeProvider — the claude-CLI lifecycle bound to the IProvider
// contract. Argv builder, env-scrub list, and stdin formatters all live
// here so transports + session-manager don't have to know they're
// talking to claude.

import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import type { HostType, SendAttachment, UserContentBlock } from '../../../shared/types'
import type {
  ControlCommand,
  EnvScrubPattern,
  IProvider,
  ProviderCapabilities,
  SpawnOpts
} from '../types'
import { validateClaudeArg } from '../../transports/validate-path'

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

  public formatUserMessage(text: string, attachments: readonly SendAttachment[]): string {
    const content = attachments.length === 0
      ? text
      : buildContentBlocks(text, attachments)
    return JSON.stringify({
      type: 'user',
      message: { role: 'user', content }
    }) + '\n'
  }

  public formatControl(cmd: ControlCommand): string | null {
    switch (cmd.kind) {
      case 'interrupt':
        // claude's stream-json control protocol: write a control_request
        // with subtype 'interrupt'. claude responds with control_response
        // (which we don't track — the next assistant/result event will
        // confirm the turn ended).
        return JSON.stringify({
          type: 'control_request',
          request_id: `req_${randomUUID()}`,
          request: { subtype: 'interrupt' }
        }) + '\n'

      case 'approval': {
        // Claude's permission-prompt-tool stdio flow: reply with a user
        // message carrying a tool_result block. Claude itself only
        // recognises allow/deny today, so acceptForSession collapses to
        // accept and cancel collapses to decline. When claude grows a
        // session-scoped "always allow", route via the /permissions
        // config rather than collapsing here.
        const allow = cmd.decision === 'accept' || cmd.decision === 'acceptForSession'
        return JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: cmd.requestId,
              content: allow ? 'allow' : 'deny'
            }]
          }
        }) + '\n'
      }

      case 'user-input-response':
        // claude has no structured user-input flow today. Returning null
        // signals session-manager that there's no in-band command to
        // write — the request silently no-ops on this provider.
        return null
    }
  }

  public envScrubList(_host: HostType): readonly EnvScrubPattern[] {
    return CLAUDE_ENV_SCRUB
  }
}

function buildContentBlocks(text: string, attachments: readonly SendAttachment[]): UserContentBlock[] {
  const blocks: UserContentBlock[] = []
  // Text-file attachments are inlined as fenced code so the model sees
  // them as part of the prompt; binary attachments become real
  // image/document blocks.
  let prelude = ''
  for (const att of attachments) {
    if (att.kind === 'text') {
      const fence = '```'
      const lang = extname(att.name).slice(1).toLowerCase()
      prelude += `${fence}${lang}${att.name ? ` ${att.name}` : ''}\n${att.text}\n${fence}\n\n`
    }
  }
  const fullText = prelude + text
  if (fullText) blocks.push({ type: 'text', text: fullText })
  for (const att of attachments) {
    if (att.kind === 'image') {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: att.mediaType, data: att.data } })
    } else if (att.kind === 'document') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: att.mediaType, data: att.data } })
    }
  }
  return blocks
}
