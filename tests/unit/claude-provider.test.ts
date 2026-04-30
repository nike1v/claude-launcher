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

describe('ClaudeProvider.formatUserMessage', () => {
  it('emits a plain stream-json user line for text-only messages', () => {
    const line = provider.formatUserMessage('hello', [])
    expect(line.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(line.trim())
    expect(parsed).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hello' }
    })
  })

  it('builds content blocks when image attachments are present', () => {
    const line = provider.formatUserMessage('look', [
      { kind: 'image', mediaType: 'image/png', data: 'AAA=' }
    ])
    const parsed = JSON.parse(line.trim())
    expect(parsed.message.content[0]).toEqual({ type: 'text', text: 'look' })
    expect(parsed.message.content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAA=' }
    })
  })

  it('inlines text-file attachments as fenced code in the prelude', () => {
    const line = provider.formatUserMessage('summarize', [
      { kind: 'text', name: 'notes.md', text: '# heading\nbody' }
    ])
    const parsed = JSON.parse(line.trim())
    const text = parsed.message.content[0].text
    expect(text).toContain('```md notes.md')
    expect(text).toContain('# heading')
    expect(text.endsWith('summarize')).toBe(true)
  })
})

describe('ClaudeProvider.formatControl', () => {
  it('builds a control_request line for interrupt', () => {
    const line = provider.formatControl({ kind: 'interrupt' })
    expect(line).not.toBeNull()
    const parsed = JSON.parse(line!.trim())
    expect(parsed.type).toBe('control_request')
    expect(parsed.request).toEqual({ subtype: 'interrupt' })
    expect(parsed.request_id).toMatch(/^req_/)
  })

  it('builds an allow tool_result for accept', () => {
    const line = provider.formatControl({
      kind: 'approval',
      requestId: 'tool-1',
      decision: 'accept'
    })
    const parsed = JSON.parse(line!.trim())
    expect(parsed.message.content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'tool-1',
      content: 'allow'
    })
  })

  it('builds a deny tool_result for decline / cancel', () => {
    for (const decision of ['decline', 'cancel'] as const) {
      const line = provider.formatControl({
        kind: 'approval',
        requestId: 'tool-1',
        decision
      })
      const parsed = JSON.parse(line!.trim())
      expect(parsed.message.content[0].content).toBe('deny')
    }
  })

  it('returns null for user-input-response (claude has no equivalent)', () => {
    const line = provider.formatControl({
      kind: 'user-input-response',
      requestId: 'q-1',
      answers: {}
    })
    expect(line).toBeNull()
  })
})

describe('ClaudeProvider.envScrubList', () => {
  it('returns the prefix + exact patterns for claude OAuth tokens', () => {
    const keys = provider.envScrubList({ kind: 'local' })
    expect([...keys]).toEqual([
      { prefix: 'CLAUDE_CODE_' },
      { exact: 'CLAUDE_RPC_TOKEN' }
    ])
  })
})
