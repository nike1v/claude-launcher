import { describe, it, expect, beforeEach } from 'vitest'
import { useMessagesStore } from '../../src/renderer/src/store/messages'
import type { NormalizedEvent } from '../../src/shared/events'

const reset = (): void => {
  useMessagesStore.setState({ eventsBySession: {} })
}

const item = (id: string): NormalizedEvent => ({
  kind: 'item.started',
  itemId: id,
  turnId: 't-1',
  itemType: 'assistant_message'
})

const completed = (id: string): NormalizedEvent => ({
  kind: 'item.completed',
  itemId: id,
  status: 'completed'
})

describe('messages store', () => {
  beforeEach(reset)

  it('appendEvents adds a batch in one mutation', () => {
    const s = useMessagesStore.getState()
    s.appendEvents('s1', [item('a'), completed('a'), item('b')])
    expect(useMessagesStore.getState().eventsBySession['s1']).toHaveLength(3)
  })

  it('appendEvents with an empty array is a no-op', () => {
    const s = useMessagesStore.getState()
    s.appendEvents('s1', [])
    expect(useMessagesStore.getState().eventsBySession['s1']).toBeUndefined()
  })

  it('appendEvents preserves order across multiple calls', () => {
    const s = useMessagesStore.getState()
    s.appendEvents('s1', [item('a')])
    s.appendEvents('s1', [item('b')])
    const events = useMessagesStore.getState().eventsBySession['s1']
    expect(events.map(e => 'itemId' in e ? e.itemId : '')).toEqual(['a', 'b'])
  })

  it('prependEvents puts events before existing ones', () => {
    const s = useMessagesStore.getState()
    s.appendEvents('s1', [item('second')])
    s.prependEvents('s1', [item('first')])
    const events = useMessagesStore.getState().eventsBySession['s1']
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ itemId: 'first' })
    expect(events[1]).toMatchObject({ itemId: 'second' })
  })

  it('clearSession removes only the targeted session', () => {
    const s = useMessagesStore.getState()
    s.appendEvents('s1', [item('a')])
    s.appendEvents('s2', [item('b')])
    s.clearSession('s1')
    expect(useMessagesStore.getState().eventsBySession['s1']).toBeUndefined()
    expect(useMessagesStore.getState().eventsBySession['s2']).toHaveLength(1)
  })
})
