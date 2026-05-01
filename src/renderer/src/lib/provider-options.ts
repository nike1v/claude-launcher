import type { ProviderKind } from '../../../shared/events'

// Display labels for the provider pickers in EnvironmentForm and
// AddProjectModal. Keep in sync with the provider modules under
// src/main/providers/<kind>/. The `bin` field is what the user needs
// installed on the env's PATH for that provider to work — surfaced as
// helper text in the form so the user knows what they're committing
// to.
export interface ProviderOption {
  value: ProviderKind
  label: string
  bin: string
}

export const PROVIDER_OPTIONS: ReadonlyArray<ProviderOption> = [
  { value: 'claude', label: 'Claude Code', bin: 'claude' },
  { value: 'codex', label: 'OpenAI Codex', bin: 'codex' },
  { value: 'cursor', label: 'Cursor Agent', bin: 'agent' },
  { value: 'opencode', label: 'opencode', bin: 'opencode' }
]

export function providerLabel(kind: ProviderKind): string {
  return PROVIDER_OPTIONS.find(o => o.value === kind)?.label ?? kind
}

export function providerBin(kind: ProviderKind): string {
  return PROVIDER_OPTIONS.find(o => o.value === kind)?.bin ?? kind
}

// Format hints for the model id field. Used as placeholders so the
// user knows what shape to type for the chosen provider — we don't
// hardcode the actual model list because:
//   1. Each provider ships new models on its own cadence and our
//      hardcoded list would lag behind / mislead users into
//      typing stale ids.
//   2. None of the four CLIs exposes a stable `--list-models` we
//      could poll, so dynamic discovery isn't reliable today.
// The user types whatever model the CLI accepts; we just suggest the
// shape via the placeholder.
const PLACEHOLDERS: Record<ProviderKind, string> = {
  claude: 'e.g. claude-opus-4-7 (leave blank for default)',
  codex: 'e.g. gpt-5-codex (leave blank for default)',
  cursor: 'e.g. auto (leave blank for default)',
  opencode: 'e.g. anthropic/claude-sonnet-4-6 (leave blank for default)'
}

export function modelPlaceholderFor(kind: ProviderKind): string {
  return PLACEHOLDERS[kind]
}
