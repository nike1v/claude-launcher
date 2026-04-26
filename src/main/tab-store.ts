import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { PersistedTabs } from '../shared/types'

const EMPTY: PersistedTabs = { tabs: [], activeIndex: null }

export class TabStore {
  public constructor(private readonly filePath: string) {}

  public load(): PersistedTabs {
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as PersistedTabs
      if (!parsed || !Array.isArray(parsed.tabs)) return EMPTY
      return parsed
    } catch {
      return EMPTY
    }
  }

  public save(state: PersistedTabs): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(state, null, 2), 'utf-8')
  }
}
