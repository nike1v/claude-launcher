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
