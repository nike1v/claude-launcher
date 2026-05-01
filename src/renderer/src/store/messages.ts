import { create } from 'zustand'
import type { NormalizedEvent } from '../../../shared/events'

// Flat event stream per session. The renderer derives RenderedItem rows
// from this stream via `deriveItems` (lib/derive-items.ts) — items
// aren't stored directly because individual events are the unit of
// reactivity (one zustand publish per event vs. recompiling items).

interface MessagesStore {
  eventsBySession: Record<string, NormalizedEvent[]>
  // Wall-clock ms of the most recent live event arrival per session.
  // Drives stale-busy detection visible from MessageList, TabBar and
  // the sidebar — going N s without an event while busy means the
  // session looks frozen. Only updated from appendEvents (live IPC),
  // not prependEvents (history replay), since history isn't activity.
  lastEventAt: Record<string, number>
  // Wall-clock ms of the user's most recent Stop click per session.
  // Used by MessageList to grade the "thinking…" hint into "stop sent…"
  // → "not acknowledged…" once we expect claude to have honoured the
  // interrupt. Cleared when the session leaves busy (turn.completed).
  stopRequestedAt: Record<string, number>
  // Append a batch of events for a session in one zustand publish.
  // Adapter chunks expand to ~5 events each — applying one mutation
  // per chunk avoids a render-storm on long histories.
  appendEvents: (sessionId: string, events: readonly NormalizedEvent[]) => void
  prependEvents: (sessionId: string, events: readonly NormalizedEvent[]) => void
  clearSession: (sessionId: string) => void
  recordStopRequest: (sessionId: string) => void
  clearStopRequest: (sessionId: string) => void
}

export const useMessagesStore = create<MessagesStore>((set) => ({
  eventsBySession: {},
  lastEventAt: {},
  stopRequestedAt: {},

  appendEvents: (sessionId, events) =>
    set(state => {
      if (events.length === 0) return state
      const existing = state.eventsBySession[sessionId] ?? []
      return {
        eventsBySession: {
          ...state.eventsBySession,
          [sessionId]: [...existing, ...events]
        },
        lastEventAt: {
          ...state.lastEventAt,
          [sessionId]: Date.now()
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
      const stopUpdated = { ...state.stopRequestedAt }
      delete stopUpdated[sessionId]
      const lastUpdated = { ...state.lastEventAt }
      delete lastUpdated[sessionId]
      return {
        eventsBySession: updated,
        stopRequestedAt: stopUpdated,
        lastEventAt: lastUpdated
      }
    }),

  recordStopRequest: (sessionId) =>
    set(state => ({
      stopRequestedAt: { ...state.stopRequestedAt, [sessionId]: Date.now() }
    })),

  clearStopRequest: (sessionId) =>
    set(state => {
      if (state.stopRequestedAt[sessionId] === undefined) return state
      const updated = { ...state.stopRequestedAt }
      delete updated[sessionId]
      return { stopRequestedAt: updated }
    })
}))
