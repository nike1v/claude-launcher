import type { Environment, HostType, PersistedTab, PersistedTabs, Project } from '../shared/types'
import { isProviderKind } from '../shared/events'

// Shape validators for the JSON files we read off disk on every boot:
// projects.json, environments.json, tabs.json. Until v0.4.37 the loaders
// did `JSON.parse(raw); return parsed as Project[]` — a hand-edited or
// corrupted file silently loaded as garbage and the renderer crashed
// later when it dereferenced the wrong-typed fields.
//
// Convention matches the existing validate-* files (validate-ssh,
// validate-path, attachment-limits): each function throws on bad input
// with a labelled error message, and uses TypeScript's `asserts` so the
// argument is narrowed on the success path. Callers (the store loaders)
// loop and try/catch per entry so one bad item doesn't poison the whole
// load — a malformed project gets dropped with a console warning, the
// rest stay.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function requireNonEmptyString(v: unknown, label: string): asserts v is string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`${label} must be a non-empty string (got ${JSON.stringify(v)})`)
  }
}

function requireOptionalString(v: unknown, label: string): asserts v is string | undefined {
  if (v === undefined) return
  if (typeof v !== 'string') {
    throw new Error(`${label} must be a string when present (got ${JSON.stringify(v)})`)
  }
}

function requireOptionalNumber(v: unknown, label: string): asserts v is number | undefined {
  if (v === undefined) return
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${label} must be a finite number when present (got ${JSON.stringify(v)})`)
  }
}

function requireOptionalProviderKind(v: unknown, label: string): void {
  if (v === undefined) return
  if (!isProviderKind(v)) {
    throw new Error(`${label} must be a known provider kind when present (got ${JSON.stringify(v)})`)
  }
}

// ── HostType (config field on Environment) ─────────────────────────────

function validateHostConfig(raw: unknown): asserts raw is HostType {
  if (!isRecord(raw)) throw new Error('config must be an object')
  const kind = raw.kind
  if (kind === 'local') return
  if (kind === 'wsl') {
    requireNonEmptyString(raw.distro, 'config.distro')
    return
  }
  if (kind === 'ssh') {
    requireNonEmptyString(raw.host, 'config.host')
    requireOptionalString(raw.user, 'config.user')
    requireOptionalString(raw.keyFile, 'config.keyFile')
    if (raw.port !== undefined) {
      if (typeof raw.port !== 'number' || !Number.isInteger(raw.port) || raw.port < 1 || raw.port > 65535) {
        throw new Error(`config.port must be an integer 1–65535 when present (got ${JSON.stringify(raw.port)})`)
      }
    }
    return
  }
  throw new Error(`config.kind must be one of 'local' | 'wsl' | 'ssh' (got ${JSON.stringify(kind)})`)
}

// ── Project ──────────────────────────────────────────────────────────────

export function validateProject(raw: unknown): asserts raw is Project {
  if (!isRecord(raw)) throw new Error('Project must be an object')
  requireNonEmptyString(raw.id, 'Project.id')
  requireNonEmptyString(raw.name, 'Project.name')
  requireNonEmptyString(raw.environmentId, 'Project.environmentId')
  requireNonEmptyString(raw.path, 'Project.path')
  requireOptionalString(raw.model, 'Project.model')
  requireOptionalProviderKind(raw.providerKind, 'Project.providerKind')
  // v0.4 → 0.5 migration: lastClaudeSessionId → lastSessionRef. Accept
  // the legacy field on read so v0.4 projects.json files load unchanged;
  // the rename is written back on the next save.
  if (raw.lastSessionRef === undefined && typeof raw.lastClaudeSessionId === 'string') {
    raw.lastSessionRef = raw.lastClaudeSessionId
  }
  delete raw.lastClaudeSessionId
  requireOptionalString(raw.lastSessionRef, 'Project.lastSessionRef')
  requireOptionalString(raw.lastModel, 'Project.lastModel')
  requireOptionalNumber(raw.lastContextWindow, 'Project.lastContextWindow')
  requireOptionalNumber(raw.lastUsedTokens, 'Project.lastUsedTokens')
}

// ── Environment ──────────────────────────────────────────────────────────

export function validateEnvironment(raw: unknown): asserts raw is Environment {
  if (!isRecord(raw)) throw new Error('Environment must be an object')
  requireNonEmptyString(raw.id, 'Environment.id')
  requireNonEmptyString(raw.name, 'Environment.name')
  validateHostConfig(raw.config)
  requireOptionalString(raw.defaultModel, 'Environment.defaultModel')
  requireOptionalProviderKind(raw.providerKind, 'Environment.providerKind')
}

// ── PersistedTab(s) ──────────────────────────────────────────────────────

export function validatePersistedTab(raw: unknown): asserts raw is PersistedTab {
  if (!isRecord(raw)) throw new Error('PersistedTab must be an object')
  requireNonEmptyString(raw.projectId, 'PersistedTab.projectId')
  // Same migration as Project: claudeSessionId → sessionRef.
  if (raw.sessionRef === undefined && typeof raw.claudeSessionId === 'string') {
    raw.sessionRef = raw.claudeSessionId
  }
  delete raw.claudeSessionId
  requireNonEmptyString(raw.sessionRef, 'PersistedTab.sessionRef')
  requireOptionalString(raw.lastModel, 'PersistedTab.lastModel')
  requireOptionalNumber(raw.lastContextWindow, 'PersistedTab.lastContextWindow')
  requireOptionalNumber(raw.lastUsedTokens, 'PersistedTab.lastUsedTokens')
}

// Top-level PersistedTabs: the wrapper object holding the tabs array
// plus the activeIndex pointer. We accept (and clamp) the active index
// when the tabs array survives but the pointer references a now-missing
// entry — it's better to lose the active selection than to fail to load
// the whole snapshot.
export function validatePersistedTabs(raw: unknown): PersistedTabs {
  if (!isRecord(raw)) throw new Error('PersistedTabs must be an object')
  if (!Array.isArray(raw.tabs)) throw new Error('PersistedTabs.tabs must be an array')
  const tabs: PersistedTab[] = []
  for (const entry of raw.tabs) {
    try {
      validatePersistedTab(entry)
      tabs.push(entry)
    } catch (err) {
      console.warn('[tabs] dropped invalid tab entry:', err instanceof Error ? err.message : err)
    }
  }
  let activeIndex: number | null = null
  if (raw.activeIndex === null || raw.activeIndex === undefined) {
    activeIndex = null
  } else if (typeof raw.activeIndex === 'number' && Number.isInteger(raw.activeIndex) && raw.activeIndex >= 0 && raw.activeIndex < tabs.length) {
    activeIndex = raw.activeIndex
  } else {
    // Out-of-range or wrong type — keep the tabs, drop the pointer.
    console.warn(`[tabs] activeIndex ${JSON.stringify(raw.activeIndex)} is invalid for ${tabs.length} tab(s); falling back to no active tab`)
    activeIndex = null
  }
  return { tabs, activeIndex }
}
