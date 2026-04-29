import type { Environment, HostType } from './types'

// Canonical "same connection" check — used by add-environment dedup, the
// migration that lifts legacy projects.host values into environments.json,
// and the duplicate detection in the Settings modal. Previously two
// implementations existed: `sameHost` (in environment-store.ts) which
// considered different SSH ports as different hosts, and
// `isSameEnvironmentTarget` (in lib/environment-dedup.ts) which treats
// port as routing detail of the same machine. The migration silently
// disagreed with the UI — that's now fixed by everyone calling this.
export function isSameHostTarget(a: HostType, b: HostType): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'local' && b.kind === 'local') return true
  if (a.kind === 'wsl' && b.kind === 'wsl') {
    return normalizeDistro(a.distro) === normalizeDistro(b.distro)
  }
  if (a.kind === 'ssh' && b.kind === 'ssh') {
    return (a.user ?? '').toLowerCase() === (b.user ?? '').toLowerCase()
      && a.host.toLowerCase() === b.host.toLowerCase()
  }
  return false
}

export function findDuplicateEnvironment(
  envs: ReadonlyArray<Environment>,
  config: HostType,
  excludeId?: string
): Environment | null {
  for (const env of envs) {
    if (excludeId && env.id === excludeId) continue
    if (isSameHostTarget(env.config, config)) return env
  }
  return null
}

// Single human label for a HostType. Replaces four near-duplicate variants
// (defaultEnvName / defaultName / describeHost / environmentLabel) that all
// agreed on the gist (`SSH · user@host`) but each picked a slightly
// different separator and field subset. Format: `Local`, `WSL · <distro>`,
// `SSH · user@host[:port]` (omitting `user@` when the connection uses an
// ssh_config alias instead).
export function describeHost(host: HostType): string {
  if (host.kind === 'local') return 'Local'
  if (host.kind === 'wsl') return `WSL · ${host.distro}`
  const target = host.user ? `${host.user}@${host.host}` : host.host
  return `SSH · ${target}${host.port ? `:${host.port}` : ''}`
}

function normalizeDistro(d: string): string {
  return d.trim().toLowerCase()
}

// Mirrors how the Claude Code CLI slugifies a project path before using it
// as the directory name under ~/.claude/projects/. Pure string manipulation
// so it can run on either side (main uses it to build cat command paths,
// renderer uses it to display the on-disk path in project settings as a
// helper-text hint). Trailing separators are stripped first — `/srv/`
// would otherwise produce `-srv-` while claude itself normalises to
// `-srv` (see history-reader-slug.test.ts for the regression).
export function claudeProjectSlug(projectPath: string): string {
  let end = projectPath.length
  while (end > 1 && (projectPath[end - 1] === '/' || projectPath[end - 1] === '\\')) end--
  return projectPath.slice(0, end).split(/[/\\]/).join('-')
}

// Human-readable hint for where the JSONL transcript files live for a
// project on a given environment. Used by the project-settings UI to
// help the user paste a session id manually if they want to resume a
// specific transcript. The exact resolved path differs by host kind:
// local → ~/.claude/projects/<slug>/, WSL → same path on the distro,
// SSH → $HOME/.claude/projects/<slug>/ on the remote.
export function transcriptDirHint(host: HostType, projectPath: string): string {
  const slug = claudeProjectSlug(projectPath)
  if (host.kind === 'local') return `~/.claude/projects/${slug}/`
  if (host.kind === 'wsl') return `~/.claude/projects/${slug}/  (on WSL · ${host.distro})`
  return `$HOME/.claude/projects/${slug}/  (on ${host.user ? `${host.user}@${host.host}` : host.host})`
}
