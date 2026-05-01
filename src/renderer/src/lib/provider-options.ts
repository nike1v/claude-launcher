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

// Suggested model ids per provider. The combobox lets users free-type
// anyway (private aliases, just-released models, opencode's
// provider/model syntax), so this list is hints, not gates. Keep
// short and conventional — exotic combinations can be typed.
export interface ModelOption {
  id: string
  label: string
}

export const MODELS_BY_PROVIDER: Record<ProviderKind, ReadonlyArray<ModelOption>> = {
  claude: [
    { id: 'claude-opus-4-7', label: 'Opus 4.7' },
    { id: 'claude-opus-4-7[1m]', label: 'Opus 4.7 (1M context)' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
    { id: 'claude-sonnet-4-6[1m]', label: 'Sonnet 4.6 (1M context)' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5' }
  ],
  codex: [
    { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
    { id: 'gpt-5', label: 'GPT-5' },
    { id: 'gpt-4o', label: 'GPT-4o' }
  ],
  // Cursor's agent picks a model server-side; the field here is a
  // pass-through alias if you want to pin one.
  cursor: [
    { id: 'auto', label: 'Auto (Cursor decides)' }
  ],
  // Opencode routes through whichever provider the user's `opencode
  // auth login` configured. The model id uses provider/model syntax.
  opencode: [
    { id: 'anthropic/claude-sonnet-4-6', label: 'Anthropic Sonnet 4.6' },
    { id: 'anthropic/claude-opus-4-7', label: 'Anthropic Opus 4.7' },
    { id: 'openai/gpt-5', label: 'OpenAI GPT-5' },
    { id: 'openai/gpt-4o', label: 'OpenAI GPT-4o' }
  ]
}

const PLACEHOLDERS: Record<ProviderKind, string> = {
  claude: 'claude-opus-4-7',
  codex: 'gpt-5-codex',
  cursor: 'auto',
  opencode: 'anthropic/claude-sonnet-4-6'
}

export function modelPlaceholderFor(kind: ProviderKind): string {
  return PLACEHOLDERS[kind]
}
