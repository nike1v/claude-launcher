import { describe, it, expect } from 'vitest'
import { ClaudeProvider } from '../../src/main/providers/claude/provider'

const provider = new ClaudeProvider()

describe('ClaudeProvider.kind / capabilities', () => {
  it('identifies as claude', () => {
    expect(provider.kind).toBe('claude')
    expect(provider.label).toBe('Claude Code')
  })

  it('exposes the expected capability flags', () => {
    expect(provider.capabilities).toEqual({
      resume: 'by-id',
      permissions: 'interactive',
      usage: 'available',
      sessionModelSwitch: 'in-session',
      transcripts: 'jsonl'
    })
  })
})

describe('ClaudeProvider.buildSpawnArgs', () => {
  it('produces the v0.4 argv shape for a vanilla call', () => {
    const built = provider.buildSpawnArgs({ cwd: '/srv/app' })
    expect(built.bin).toBe('claude')
    expect([...built.args]).toEqual([
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--permission-prompt-tool', 'stdio'
    ])
  })

  it('appends --model when set', () => {
    const built = provider.buildSpawnArgs({ cwd: '/x', model: 'claude-opus-4-7' })
    expect([...built.args]).toContain('--model')
    expect([...built.args]).toContain('claude-opus-4-7')
  })

  it('appends --resume when resumeRef is set', () => {
    const built = provider.buildSpawnArgs({ cwd: '/x', resumeRef: 'sess-abc' })
    expect([...built.args]).toContain('--resume')
    expect([...built.args]).toContain('sess-abc')
  })

  it('rejects a model with control characters', () => {
    expect(() => provider.buildSpawnArgs({ cwd: '/x', model: 'opus\x00' }))
      .toThrow(/control characters/)
  })
})

// formatUserMessage / formatControl moved to ClaudeAdapter (where the
// per-session state for stateful providers lives) — test suites for
// those live in tests/unit/claude-adapter.test.ts.

describe('ClaudeProvider.envScrubList', () => {
  it('returns the prefix + exact patterns for claude OAuth tokens', () => {
    const keys = provider.envScrubList({ kind: 'local' })
    expect([...keys]).toEqual([
      { prefix: 'CLAUDE_CODE_' },
      { exact: 'CLAUDE_RPC_TOKEN' }
    ])
  })
})
