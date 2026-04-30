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
  it('registers all four providers', () => {
    initProviders()
    expect(hasProvider('claude')).toBe(true)
    expect(hasProvider('codex')).toBe(true)
    expect(hasProvider('cursor')).toBe(true)
    expect(hasProvider('opencode')).toBe(true)
    expect(getProvider('claude').kind).toBe('claude')
    expect(getProvider('codex').kind).toBe('codex')
    expect(getProvider('cursor').kind).toBe('cursor')
    expect(getProvider('opencode').kind).toBe('opencode')
  })

  it('is idempotent — calling twice does not throw', () => {
    initProviders()
    expect(() => initProviders()).not.toThrow()
  })
})
