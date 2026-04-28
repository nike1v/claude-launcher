// Bits all three transports (and the usage-probe PTY driver) need.
// Pulled out of the transport classes once we noticed the same argv
// builder and env-filter were copy-pasted three times.

const BASE_CLAUDE_ARGS = [
  '--output-format', 'stream-json',
  '--input-format', 'stream-json',
  '--verbose',
  '--permission-prompt-tool', 'stdio'
] as const

// The argv we hand claude for the regular spawn path. Excludes the PTY-only
// `--permission-mode default` invocation used by the usage probe — that one
// stays inline in usage-probe.ts to keep the difference visible.
export function buildClaudeArgs(model?: string, resumeSessionId?: string): string[] {
  const args: string[] = [...BASE_CLAUDE_ARGS]
  if (model) args.push('--model', model)
  if (resumeSessionId) args.push('--resume', resumeSessionId)
  return args
}

// Strip OAuth tokens belonging to *our* claude (the launcher app's own
// session) before they reach a remote / wsl child. The remote side has its
// own ~/.claude credentials and we don't want to clobber them with the host's.
export function filteredEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith('CLAUDE_CODE_') && key !== 'CLAUDE_RPC_TOKEN'
    )
  ) as NodeJS.ProcessEnv
}
