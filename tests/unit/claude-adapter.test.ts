import { describe, it, expect } from 'vitest'
import { ClaudeAdapter } from '../../src/main/providers/claude/adapter'

// PR 2 ships ClaudeAdapter with placeholder methods. PR 3 fills them in
// alongside the renderer rewrite — at which point this test grows into
// a real translation suite (StreamJsonEvent → NormalizedEvent fixtures).

describe('ClaudeAdapter (placeholder)', () => {
  const adapter = new ClaudeAdapter()

  it('identifies as claude', () => {
    expect(adapter.kind).toBe('claude')
  })

  it('parseChunk returns [] until PR 3 wires real translation', () => {
    expect(adapter.parseChunk('{"type":"system"}\n')).toEqual([])
  })

  it('parseTranscript returns [] until PR 3 wires real translation', () => {
    expect(adapter.parseTranscript('whatever')).toEqual([])
  })
})
