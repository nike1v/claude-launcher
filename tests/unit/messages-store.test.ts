import { describe, it, expect, beforeEach } from 'vitest'
import { useMessagesStore } from '../../src/renderer/src/store/messages'
import type { NormalizedEvent } from '../../src/shared/events'

const reset = (): void => {
  useMessagesStore.setState({ eventsBySession: {} })
}

const assistantItem = (id: string): NormalizedEvent => ({
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

  it('appends events in order', () => {
    const s = useMessagesStore.getState()
    s.appendEvent('s1', assistantItem('a'))
    s.appendEvent('s1', completed('a'))
    expect(useMessagesStore.getState().eventsBySession['s1']).toHaveLength(2)
  })

  it('prependEvents puts events before existing ones', () => {
    const s = useMessagesStore.getState()
    s.appendEvent('s1', assistantItem('second'))
    s.prependEvents('s1', [assistantItem('first')])
    const events = useMessagesStore.getState().eventsBySession['s1']
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ itemId: 'first' })
    expect(events[1]).toMatchObject({ itemId: 'second' })
  })

  it('clearSession removes only the targeted session', () => {
    const s = useMessagesStore.getState()
    s.appendEvent('s1', assistantItem('a'))
    s.appendEvent('s2', assistantItem('b'))
    s.clearSession('s1')
    expect(useMessagesStore.getState().eventsBySession['s1']).toBeUndefined()
    expect(useMessagesStore.getState().eventsBySession['s2']).toHaveLength(1)
  })
})
