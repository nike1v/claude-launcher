import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Environment, HostType, Project } from '../shared/types'

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
  const match = envs.find(e => sameHost(e.config, host))
  if (match) return match
  const created: Environment = {
    id: randomUUID(),
    name: defaultEnvName(host),
    config: host
  }
  envs.push(created)
  return created
}

function sameHost(a: HostType, b: HostType): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'local' && b.kind === 'local') return true
  if (a.kind === 'wsl' && b.kind === 'wsl') return a.distro === b.distro
  if (a.kind === 'ssh' && b.kind === 'ssh') {
    return a.user === b.user && a.host === b.host && (a.port ?? 22) === (b.port ?? 22)
  }
  return false
}

function defaultEnvName(host: HostType): string {
  if (host.kind === 'local') return 'Local'
  if (host.kind === 'wsl') return `WSL · ${host.distro}`
  return `SSH · ${host.user}@${host.host}`
}
