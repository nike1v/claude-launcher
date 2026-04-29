import { describe, it, expect, beforeEach } from 'vitest'
import { useMessagesStore } from '../../src/renderer/src/store/messages'
import type { StreamJsonEvent } from '../../src/shared/types'

const reset = (): void => {
  useMessagesStore.setState({ messagesBySession: {} })
}

const makeAssistant = (text: string): StreamJsonEvent => ({
  type: 'assistant',
  message: {
    id: 'msg-1',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: 'claude-opus-4-7',
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 }
  }
})

describe('messages store — appendEvent dedup', () => {
  beforeEach(reset)

  it('appends assistant events without filtering', () => {
    useMessagesStore.getState().appendEvent('s1', makeAssistant('hello'))
    expect(useMessagesStore.getState().messagesBySession['s1']).toHaveLength(1)
  })

  // Plain-string user events come from the SDK echoing what we typed back to
  // us — InputBar already pushed a local bubble with the __input__ marker,
  // so dropping the SDK's plain-string echo prevents a duplicated user
  // message in the chat log.
  it('drops plain-string user echo (SDK replays user input as content="...")', () => {
    useMessagesStore.getState().appendEvent('s1', {
      type: 'user',
      message: { role: 'user', content: 'hello' }
    })
    expect(useMessagesStore.getState().messagesBySession['s1']).toBeUndefined()
  })

  it('keeps user events that carry the __input__ marker (locally-echoed)', () => {
    useMessagesStore.getState().appendEvent('s1', {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_result', tool_use_id: '__input__', content: '' }
        ]
      }
    })
    expect(useMessagesStore.getState().messagesBySession['s1']).toHaveLength(1)
  })

  it('keeps user events that are pure tool_result responses (permission replies)', () => {
    useMessagesStore.getState().appendEvent('s1', {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tool-abc', content: 'allow' }
        ]
      }
    })
    expect(useMessagesStore.getState().messagesBySession['s1']).toHaveLength(1)
  })

  it('drops user events with text content + no __input__ marker (attachment-ful echo)', () => {
    useMessagesStore.getState().appendEvent('s1', {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'hello again' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGk=' } }
        ]
      }
    })
    expect(useMessagesStore.getState().messagesBySession['s1']).toBeUndefined()
  })

  it('prependEvents puts events before existing ones', () => {
    const s = useMessagesStore.getState()
    s.appendEvent('s1', makeAssistant('second'))
    s.prependEvents('s1', [makeAssistant('first')])
    const msgs = useMessagesStore.getState().messagesBySession['s1']
    expect(msgs).toHaveLength(2)
    const texts = msgs.map(m => {
      const e = m.event
      if (e.type !== 'assistant') return ''
      const block = e.message.content[0]
      return block.type === 'text' ? block.text : ''
    })
    expect(texts).toEqual(['first', 'second'])
  })

  it('clearSession removes only the targeted session', () => {
    const s = useMessagesStore.getState()
    s.appendEvent('s1', makeAssistant('a'))
    s.appendEvent('s2', makeAssistant('b'))
    s.clearSession('s1')
    expect(useMessagesStore.getState().messagesBySession['s1']).toBeUndefined()
    expect(useMessagesStore.getState().messagesBySession['s2']).toHaveLength(1)
  })
})
