import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Environment, HostType, Project } from '../shared/types'
import { validateSshHost, validateWslDistro } from './transports/validate-ssh'
import { isSameHostTarget, describeHost } from '../shared/host-utils'

// True iff this HostType passes the same validation we apply at spawn time.
// Used by the migration path so a corrupted projects.json can't smuggle a
// host with a leading-dash hostname (or whitespace, control bytes, etc.)
// from the old `Project.host` field into the new environments.json.
function isValidHost(host: HostType): boolean {
  try {
    if (host.kind === 'ssh') validateSshHost(host)
    else if (host.kind === 'wsl') validateWslDistro(host.distro)
    return true
  } catch {
    return false
  }
}

export class EnvironmentStore {
  public constructor(private readonly filePath: string) {}

  public load(): Environment[] {
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed as Environment[]
    } catch {
      return []
    }
  }

  public save(envs: Environment[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(envs, null, 2), 'utf-8')
  }

  public exists(): boolean {
    return existsSync(this.filePath)
  }
}

// One-shot migration: legacy projects.json had a `host` per project, now we
// pull each unique host into an Environment and rewrite projects so each
// references its environment by id. Idempotent — projects already on the new
// shape (with environmentId) are left alone.
export function migrateProjectsToEnvironments(
  projects: unknown[],
  existing: Environment[]
): { projects: Project[]; environments: Environment[]; changed: boolean } {
  const envs: Environment[] = [...existing]
  const out: Project[] = []
  let changed = false

  for (const raw of projects) {
    if (!raw || typeof raw !== 'object') continue
    const p = raw as Partial<Project> & { host?: HostType }
    if (p.environmentId) {
      out.push(p as Project)
      continue
    }
    if (!p.host || !p.id || !p.name || !p.path) continue
    // Skip projects whose persisted host can't pass the live validators —
    // that would just rewrite the bogus host into environments.json and
    // make it survive a manual cleanup of projects.json.
    if (!isValidHost(p.host)) continue
    const env = findOrCreateEnvironment(envs, p.host)
    out.push({
      id: p.id,
      name: p.name,
      path: p.path,
      model: p.model,
      environmentId: env.id
    })
    changed = true
  }

  return { projects: out, environments: envs, changed }
}

function findOrCreateEnvironment(envs: Environment[], host: HostType): Environment {
  // Use the shared dedup so a v0.3 install with `port: 22` explicit doesn't
  // double-migrate against a v0.4 environments.json that omits the port. The
  // UI uses the same comparator for "Add Environment" duplicate detection.
  const match = envs.find(e => isSameHostTarget(e.config, host))
  if (match) return match
  const created: Environment = {
    id: randomUUID(),
    name: describeHost(host),
    config: host
  }
  envs.push(created)
  return created
}
