import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { PersistedTabs } from '../shared/types'
import { validatePersistedTabs } from './validate-persisted'

const EMPTY: PersistedTabs = { tabs: [], activeIndex: null }

export class TabStore {
  public constructor(private readonly filePath: string) {}

  public load(): PersistedTabs {
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf-8'))
    } catch {
      return EMPTY
    }
    try {
      // validatePersistedTabs is the one validator that returns its
      // result (instead of asserting + side-effecting) — it loops the
      // tabs array internally and drops any malformed entries with a
      // console warning, so the snapshot can survive partial corruption
      // (one bad tab doesn't sink the whole restore).
      return validatePersistedTabs(parsed)
    } catch (err) {
      console.warn('[TabStore] tabs.json is malformed at the top level; treating as empty:', err instanceof Error ? err.message : err)
      return EMPTY
    }
  }

  public save(state: PersistedTabs): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(state, null, 2), 'utf-8')
  }
}
