import { describe, it, expect, beforeEach } from 'vitest'
import { useSessionsStore } from '../../src/renderer/src/store/sessions'
import type { Session } from '../../src/shared/types'

const makeSession = (id: string, projectId = 'proj'): Session => ({
  id,
  projectId,
  status: 'ready',
  hasUnread: false
})

const reset = (): void => {
  useSessionsStore.setState({ sessions: {}, tabOrder: [], activeSessionId: null })
}

describe('sessions store — addSession / removeSession indexing', () => {
  beforeEach(reset)

  it('addSession appends to tabOrder and makes the new session active', () => {
    const s = useSessionsStore.getState()
    s.addSession(makeSession('a'))
    s.addSession(makeSession('b'))
    expect(useSessionsStore.getState().tabOrder).toEqual(['a', 'b'])
    expect(useSessionsStore.getState().activeSessionId).toBe('b')
  })

  // Off-by-one trap: removing the active tab promotes the previous tab,
  // not the first or last unconditionally. Pin the rule.
  it('removeSession of active tab activates the previous tab', () => {
    const s = useSessionsStore.getState()
    s.addSession(makeSession('a'))
    s.addSession(makeSession('b'))
    s.addSession(makeSession('c')) // c is now active
    s.removeSession('c')
    expect(useSessionsStore.getState().activeSessionId).toBe('b')
    expect(useSessionsStore.getState().tabOrder).toEqual(['a', 'b'])
  })

  it('removeSession of first tab when first is active activates the new first', () => {
    const s = useSessionsStore.getState()
    s.addSession(makeSession('a'))
    s.addSession(makeSession('b'))
    s.setActiveSession('a')
    s.removeSession('a')
    expect(useSessionsStore.getState().activeSessionId).toBe('b')
  })

  it('removeSession of a non-active tab leaves activeSessionId alone', () => {
    const s = useSessionsStore.getState()
    s.addSession(makeSession('a'))
    s.addSession(makeSession('b'))
    s.addSession(makeSession('c'))
    s.setActiveSession('c')
    s.removeSession('a')
    expect(useSessionsStore.getState().activeSessionId).toBe('c')
    expect(useSessionsStore.getState().tabOrder).toEqual(['b', 'c'])
  })

  it('removeSession of the last remaining tab clears activeSessionId', () => {
    const s = useSessionsStore.getState()
    s.addSession(makeSession('only'))
    s.removeSession('only')
    expect(useSessionsStore.getState().activeSessionId).toBeNull()
    expect(useSessionsStore.getState().tabOrder).toEqual([])
    expect(useSessionsStore.getState().sessions).toEqual({})
  })

  // Regression for v0.4.8: a status event arriving after removeSession used
  // to crash on `state.sessions[sessionId]!` non-null assertion. The store
  // now no-ops gracefully.
  it('updateSession is a no-op when the session was already removed', () => {
    const s = useSessionsStore.getState()
    s.addSession(makeSession('a'))
    s.removeSession('a')
    expect(() => s.updateSession('a', { status: 'busy' })).not.toThrow()
    expect(useSessionsStore.getState().sessions).toEqual({})
  })

  it('markRead is a no-op when the session was already removed', () => {
    const s = useSessionsStore.getState()
    s.addSession(makeSession('a'))
    s.removeSession('a')
    expect(() => s.markRead('a')).not.toThrow()
  })

  it('setActiveSession + markRead clears hasUnread', () => {
    const s = useSessionsStore.getState()
    s.addSession({ ...makeSession('a'), hasUnread: true })
    expect(useSessionsStore.getState().sessions['a'].hasUnread).toBe(true)
    s.setActiveSession('a')
    expect(useSessionsStore.getState().sessions['a'].hasUnread).toBe(false)
  })
})
