import { describe, it, expect } from 'vitest'
import { parseStreamJsonLine } from '../../src/main/stream-json-parser'

describe('parseStreamJsonLine', () => {
  it('returns null for empty line', () => {
    expect(parseStreamJsonLine('')).toBeNull()
  })

  it('returns null for non-JSON line', () => {
    expect(parseStreamJsonLine('not json')).toBeNull()
  })

  it('parses init event', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-123',
      model: 'claude-sonnet-4-5',
      cwd: '/tmp',
      tools: [],
      mcp_servers: []
    })
    const result = parseStreamJsonLine(line)
    expect(result).not.toBeNull()
    expect(result?.type).toBe('system')
    if (result?.type === 'system' && result.subtype === 'init') {
      expect(result.session_id).toBe('sess-123')
      expect(result.model).toBe('claude-sonnet-4-5')
    }
  })

  it('parses assistant event with text content', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg-1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello!' }],
        model: 'claude-sonnet-4-5',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 }
      }
    })
    const result = parseStreamJsonLine(line)
    expect(result?.type).toBe('assistant')
    if (result?.type === 'assistant') {
      expect(result.message.content[0]).toEqual({ type: 'text', text: 'Hello!' })
    }
  })

  it('parses result event', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: 'sess-123',
      cost_usd: 0.001,
      duration_ms: 1234,
      is_error: false,
      num_turns: 1
    })
    const result = parseStreamJsonLine(line)
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.cost_usd).toBe(0.001)
      expect(result.is_error).toBe(false)
    }
  })

  it('returns null for unknown event type', () => {
    const line = JSON.stringify({ type: 'unknown_future_type', data: 'x' })
    expect(parseStreamJsonLine(line)).toBeNull()
  })

  it('parses system.status compacting and exit events', () => {
    const enter = parseStreamJsonLine(JSON.stringify({
      type: 'system',
      subtype: 'status',
      status: 'compacting'
    }))
    expect(enter).toMatchObject({ type: 'system', subtype: 'status', status: 'compacting' })

    const exit = parseStreamJsonLine(JSON.stringify({
      type: 'system',
      subtype: 'status',
      status: null,
      compact_result: 'success'
    }))
    expect(exit).toMatchObject({ type: 'system', subtype: 'status', status: null })
  })

  it('drops system.status with unrecognised status values', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'status',
      status: 'wat-future-phase'
    })
    expect(parseStreamJsonLine(line)).toBeNull()
  })
})
