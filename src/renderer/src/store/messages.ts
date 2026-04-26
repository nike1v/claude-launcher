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
      // Drop the SDK's echo of what we just typed — InputBar already pushed a
      // local bubble with the __input__ marker. Plain-string echoes always
      // came from us; array echoes that don't carry __input__ AND aren't pure
      // tool_result responses (which are our permission replies) are also
      // echoes of attachment-ful prompts we already rendered locally.
      if (event.type === 'user') {
        const c = event.message.content
        if (typeof c === 'string') return state
        const hasInputMarker = c.some(b => b.type === 'tool_result' && b.tool_use_id === '__input__')
        const onlyToolResults = c.every(b => b.type === 'tool_result')
        if (!hasInputMarker && !onlyToolResults) return state
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
