import { describe, it, expect, beforeEach } from 'vitest'
import { initProviders } from '../../src/main/providers/init'
import {
  hasProvider,
  getProvider,
  unregisterAll
} from '../../src/main/providers/registry'

beforeEach(() => {
  unregisterAll()
})

describe('initProviders', () => {
  it('registers ClaudeProvider and CodexProvider', () => {
    initProviders()
    expect(hasProvider('claude')).toBe(true)
    expect(hasProvider('codex')).toBe(true)
    expect(getProvider('claude').kind).toBe('claude')
    expect(getProvider('codex').kind).toBe('codex')
  })

  it('is idempotent — calling twice does not throw', () => {
    initProviders()
    expect(() => initProviders()).not.toThrow()
  })
})
