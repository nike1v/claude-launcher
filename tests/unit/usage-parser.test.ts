import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UsageBar } from '../../src/shared/types'
import { parseUsage, cleanPtyOutput } from '../../src/main/usage-parser'

const fixture = readFileSync(join(__dirname, '../fixtures/usage-output.bin'), 'utf-8')

describe('usage-parser', () => {
  it('extracts the three usage bars from a real claude /usage capture', () => {
    const result = parseUsage(fixture)
    const keys = result.bars.map(b => b.key)
    expect(keys).toContain('session')
    expect(keys).toContain('weekly_all')
    expect(keys).toContain('weekly_sonnet')
  })

  it('returns percent values within 0-100 for every bar', () => {
    const result = parseUsage(fixture)
    expect(result.bars.length).toBeGreaterThanOrEqual(3)
    for (const bar of result.bars) {
      expect(bar.percent).toBeGreaterThanOrEqual(0)
      expect(bar.percent).toBeLessThanOrEqual(100)
    }
  })

  it('captures resets-at strings for each bar', () => {
    const result = parseUsage(fixture)
    const session = result.bars.find(b => b.key === 'session')
    expect(session?.resetsAt).toBeTruthy()
    expect(session?.resetsAt).toMatch(/[0-9]/)
    const weekly = result.bars.find(b => b.key === 'weekly_all')
    expect(weekly?.resetsAt).toMatch(/Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Jan|Feb|Mar/i)
  })

  it('expands cursor-right escapes back into spaces', () => {
    // Without the \x1b[<n>C → spaces step, "Current" and "session" merge and
    // labels stop matching.
    const cleaned = cleanPtyOutput('Current\x1b[1Csession')
    expect(cleaned).toContain('Current session')
  })

  it('returns the cleaned text alongside the parsed bars for debug viewing', () => {
    const result = parseUsage(fixture)
    expect(result.rawText.length).toBeGreaterThan(0)
    expect(result.rawText).not.toContain('\x1b[')
  })

  it('returns an empty bar list when given garbage input rather than throwing', () => {
    const result = parseUsage('this is not the /usage output')
    expect(result.bars).toEqual([])
  })
})
