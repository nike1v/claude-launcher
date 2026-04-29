import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Project } from '../shared/types'
import { validateProject } from './validate-persisted'

export class ProjectStore {
  public constructor(private readonly filePath: string) {}

  public load(): Project[] {
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf-8'))
    } catch {
      return []
    }
    if (!Array.isArray(parsed)) {
      console.warn('[ProjectStore] projects.json is not an array; ignoring file')
      return []
    }
    // One bad entry shouldn't sink the whole list — drop it with a
    // warning and load the rest. Without this the renderer would later
    // crash on undefined.name / etc. when rendering the row.
    const valid: Project[] = []
    for (const entry of parsed) {
      try {
        validateProject(entry)
        valid.push(entry)
      } catch (err) {
        console.warn('[ProjectStore] dropped invalid project entry:', err instanceof Error ? err.message : err)
      }
    }
    return valid
  }

  public save(projects: Project[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(projects, null, 2), 'utf-8')
  }
}
