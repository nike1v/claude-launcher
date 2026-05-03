import { describe, it, expect } from 'vitest'
import { formatElapsed } from '../../src/renderer/src/lib/format-time'

describe('formatElapsed', () => {
  it('shows whole seconds under a minute', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(999)).toBe('0s')
    expect(formatElapsed(1_000)).toBe('1s')
    expect(formatElapsed(45_500)).toBe('45s')
    expect(formatElapsed(59_999)).toBe('59s')
  })

  it('switches to "Xm Ys" at one minute', () => {
    expect(formatElapsed(60_000)).toBe('1m 0s')
    expect(formatElapsed(75_000)).toBe('1m 15s')
    expect(formatElapsed(2 * 60_000 + 13_000)).toBe('2m 13s')
    expect(formatElapsed(10 * 60_000)).toBe('10m 0s')
  })

  it('handles negative or NaN inputs as 0s', () => {
    expect(formatElapsed(-5)).toBe('0s')
    expect(formatElapsed(Number.NaN)).toBe('0s')
    expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe('0s')
  })
})
