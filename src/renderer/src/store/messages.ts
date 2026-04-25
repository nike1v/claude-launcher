import { create } from 'zustand'
import type { StreamJsonEvent } from '../../../shared/types'

export interface ChatMessage {
  id: string
  event: StreamJsonEvent
  timestamp: number
}

interface MessagesStore {
  messagesBySession: Record<string, ChatMessage[]>
  appendEvent: (sessionId: string, event: StreamJsonEvent) => void
  prependEvents: (sessionId: string, events: StreamJsonEvent[]) => void
  clearSession: (sessionId: string) => void
}

export const useMessagesStore = create<MessagesStore>((set) => ({
  messagesBySession: {},

  appendEvent: (sessionId, event) =>
    set(state => {
      // Live echo of typed input — InputBar already rendered it locally with the
      // __input__ marker, so dropping the SDK echo prevents a duplicate bubble.
      if (event.type === 'user' && typeof event.message.content === 'string') {
        return state
      }
      const existing = state.messagesBySession[sessionId] ?? []
      const message: ChatMessage = { id: crypto.randomUUID(), event, timestamp: Date.now() }
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: [...existing, message]
        }
      }
    }),

  prependEvents: (sessionId, events) =>
    set(state => {
      const existing = state.messagesBySession[sessionId] ?? []
      const messages: ChatMessage[] = events.map(event => ({ id: crypto.randomUUID(), event, timestamp: Date.now() }))
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: [...messages, ...existing]
        }
      }
    }),

  clearSession: (sessionId) =>
    set(state => {
      const updated = { ...state.messagesBySession }
      delete updated[sessionId]
      return { messagesBySession: updated }
    })
}))
