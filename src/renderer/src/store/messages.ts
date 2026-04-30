import { create } from 'zustand'
import type { NormalizedEvent } from '../../../shared/events'

// Flat event stream per session. The renderer derives RenderedItem rows
// from this stream via `deriveItems` (lib/derive-items.ts) — items
// aren't stored directly because individual events are the unit of
// reactivity (one zustand publish per event vs. recompiling items).

interface MessagesStore {
  eventsBySession: Record<string, NormalizedEvent[]>
  appendEvent: (sessionId: string, event: NormalizedEvent) => void
  prependEvents: (sessionId: string, events: readonly NormalizedEvent[]) => void
  clearSession: (sessionId: string) => void
}

export const useMessagesStore = create<MessagesStore>((set) => ({
  eventsBySession: {},

  appendEvent: (sessionId, event) =>
    set(state => {
      const existing = state.eventsBySession[sessionId] ?? []
      return {
        eventsBySession: {
          ...state.eventsBySession,
          [sessionId]: [...existing, event]
        }
      }
    }),

  prependEvents: (sessionId, events) =>
    set(state => {
      const existing = state.eventsBySession[sessionId] ?? []
      return {
        eventsBySession: {
          ...state.eventsBySession,
          [sessionId]: [...events, ...existing]
        }
      }
    }),

  clearSession: (sessionId) =>
    set(state => {
      const updated = { ...state.eventsBySession }
      delete updated[sessionId]
      return { eventsBySession: updated }
    })
}))
