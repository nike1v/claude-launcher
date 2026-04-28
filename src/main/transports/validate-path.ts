// Defense-in-depth check on user-supplied project / model strings before they
// reach a remote shell. The actual injection guard is `shQuote()` — wrapping
// in POSIX single quotes makes shell metacharacters inert. This validator
// rejects values that would still cause trouble *inside* a single-quoted
// string: NUL bytes (which terminate argv on most platforms), and other
// control characters that can confuse path lookup or log output.
//
// Why this matters: project.path comes from PathCombobox (renderer text
// input) or from a tampered projects.json on disk. Before this guard, an
// SSH spawn embedded the value via JSON.stringify(path) inside `sh -c "..."`,
// where `$(...)` and backticks expand. That was the v0.4.7 RCE surface.

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/

export function validateProjectPath(path: string): void {
  if (typeof path !== 'string' || !path.length) {
    throw new Error('Project path must be a non-empty string')
  }
  if (CONTROL_CHARS.test(path)) {
    throw new Error('Project path contains control characters')
  }
}

// Same constraints for free-form argv values we forward to claude (model id,
// resume session id). claude itself wouldn't accept newlines in these, so
// rejecting them up front gives a clearer failure than waiting for the CLI to
// reject and exit with code 1.
export function validateClaudeArg(value: string, label: string): void {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  if (CONTROL_CHARS.test(value)) {
    throw new Error(`${label} contains control characters`)
  }
}
