// ClaudeProvider — wraps the existing claude-CLI behaviour behind the
// provider/adapter contracts. Pure relocation: the argv builder, transcript
// path, env-scrub list, and stdin formatters are the same code as v0.4 just
// pulled into one class.
//
// PR 2 wires this into session-manager + transports + history-reader.
// PR 3 will switch the live event path to flow through ClaudeAdapter; in
// PR 2 the adapter exists but session-manager / history-reader keep
// calling parseStreamJsonLine directly so the renderer doesn't change.

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  HostType,
  SendAttachment,
  UserContentBlock
} from '../../../shared/types'
import { claudeProjectSlug } from '../../../shared/host-utils'
import type {
  ControlCommand,
  IProvider,
  ProbeResult,
  ProviderCapabilities,
  SpawnOpts
} from '../types'
import { resolveTransport } from '../../transports'
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
// the host's. We can't just enumerate `process.env` here — transports
// invoke this once per spawn — so we return the prefix-keys; the
// transport's env filter applies them.
const CLAUDE_ENV_SCRUB_KEYS = ['CLAUDE_CODE_*', 'CLAUDE_RPC_TOKEN'] as const

export class ClaudeProvider implements IProvider {
  public readonly kind = 'claude' as const
  public readonly label = 'Claude Code'
  public readonly capabilities = CAPABILITIES

  public async probeBinary(host: HostType): Promise<ProbeResult> {
    // Delegates to the transport's probe — which today already runs
    // `claude --version` and grep's for the "Claude Code" banner.
    // When codex / opencode / cursor land we'll generalize the probe so
    // each provider supplies its own binary name + version-line matcher;
    // PR 2 leaves that flow alone since claude is still the only thing
    // anyone is probing.
    const transport = resolveTransport(host)
    return transport.probe(host)
  }

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
    if (cmd.kind === 'interrupt') {
      // claude's stream-json control protocol: write a control_request
      // with subtype 'interrupt'. claude responds with control_response
      // (which we don't track — the next assistant/result event will
      // confirm the turn ended).
      return JSON.stringify({
        type: 'control_request',
        request_id: `req_${randomUUID()}`,
        request: { subtype: 'interrupt' }
      }) + '\n'
    }
    if (cmd.kind === 'approval') {
      // Claude's permission-prompt-tool stdio flow: reply with a user
      // message carrying a tool_result block. v0.4 only wired
      // 'allow'/'deny'; widen to the four-state ApprovalDecision now
      // even though only allow/deny actually round-trip through the
      // renderer (claude itself doesn't recognize the new states yet).
      const allow = cmd.decision === 'accept' || cmd.decision === 'acceptForSession'
      const content = allow ? 'allow' : 'deny'
      return JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: cmd.requestId, content }]
        }
      }) + '\n'
    }
    if (cmd.kind === 'user-input-response') {
      // claude has no structured user-input flow today — codex / opencode
      // do. Returning null lets the session-manager decide whether to
      // ignore (we will) or fall back to something else.
      return null
    }
    return null
  }

  public transcriptDir(host: HostType, projectPath: string): string | null {
    const slug = claudeProjectSlug(projectPath)
    if (host.kind === 'local') {
      return join(homedir(), '.claude', 'projects', slug)
    }
    // Remote — return a $HOME-prefixed path the bash -c caller will expand.
    // shellEscape is the caller's responsibility; we don't know whether
    // they need single- or double-quote escaping for their wrapper.
    return `$HOME/.claude/projects/${slug}`
  }

  public envScrubList(_host: HostType): readonly string[] {
    return CLAUDE_ENV_SCRUB_KEYS
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
      const lang = extensionFromName(att.name)
      prelude += `${fence}${lang ? lang : ''}${att.name ? ` ${att.name}` : ''}\n${att.text}\n${fence}\n\n`
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

function extensionFromName(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return ''
  return name.slice(dot + 1).toLowerCase()
}
