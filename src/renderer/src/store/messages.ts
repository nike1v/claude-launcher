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
  clearSession: (sessionId: string) => void
}

export const useMessagesStore = create<MessagesStore>((set) => ({
  messagesBySession: {},

  appendEvent: (sessionId, event) =>
    set(state => {
      const existing = state.messagesBySession[sessionId] ?? []
      const message: ChatMessage = { id: crypto.randomUUID(), event, timestamp: Date.now() }
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: [...existing, message]
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
