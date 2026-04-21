import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Project } from '../shared/types'

export class ProjectStore {
  public constructor(private readonly filePath: string) {}

  public load(): Project[] {
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      return JSON.parse(raw) as Project[]
    } catch {
      return []
    }
  }

  public save(projects: Project[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(projects, null, 2), 'utf-8')
  }
}
