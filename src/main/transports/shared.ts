// Bits all three transports need. Pulled out of the transport classes
// once we noticed the same env-filter was copy-pasted three times.
//
// The argv builder used to live here as `buildClaudeArgs`; it moved into
// `src/main/providers/claude/provider.ts` in PR 2. Each provider now
// owns its own argv shape — transports just spawn (bin, args) blindly.

// Filter `process.env` by a provider-supplied list of keys / prefix
// patterns. Patterns ending with '*' match a prefix (e.g.
// `CLAUDE_CODE_*` strips every key starting with `CLAUDE_CODE_`); other
// entries match exactly. Used by WSL / SSH transports to scrub
// provider-specific OAuth tokens before they reach a remote child —
// the remote has its own credentials and shouldn't inherit the
// launcher's.
export function filteredEnvFor(scrubKeys: readonly string[]): NodeJS.ProcessEnv {
  if (scrubKeys.length === 0) return { ...process.env }
  return Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !matchesAny(k, scrubKeys))
  ) as NodeJS.ProcessEnv
}

function matchesAny(key: string, patterns: readonly string[]): boolean {
  for (const p of patterns) {
    if (p.endsWith('*')) {
      if (key.startsWith(p.slice(0, -1))) return true
    } else if (key === p) {
      return true
    }
  }
  return false
}
