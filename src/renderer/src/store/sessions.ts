import { create } from 'zustand'
import type { Session } from '../../../shared/types'

interface SessionsStore {
  sessions: Record<string, Session>
  tabOrder: string[]
  activeSessionId: string | null

  addSession: (session: Session) => void
  updateSession: (sessionId: string, update: Partial<Session>) => void
  removeSession: (sessionId: string) => void
  setActiveSession: (sessionId: string | null) => void
  markRead: (sessionId: string) => void
}

export const useSessionsStore = create<SessionsStore>((set, get) => ({
  sessions: {},
  tabOrder: [],
  activeSessionId: null,

  addSession: (session) =>
    set(state => ({
      sessions: { ...state.sessions, [session.id]: session },
      tabOrder: [...state.tabOrder, session.id],
      activeSessionId: session.id
    })),

  updateSession: (sessionId, update) =>
    set(state => ({
      sessions: {
        ...state.sessions,
        [sessionId]: { ...state.sessions[sessionId]!, ...update }
      }
    })),

  removeSession: (sessionId) => {
    const { tabOrder, activeSessionId } = get()
    const newOrder = tabOrder.filter(id => id !== sessionId)
    const newActive =
      activeSessionId === sessionId
        ? (newOrder[newOrder.indexOf(sessionId) - 1] ?? newOrder[0] ?? null)
        : activeSessionId
    set(state => {
      const sessions = { ...state.sessions }
      delete sessions[sessionId]
      return { sessions, tabOrder: newOrder, activeSessionId: newActive }
    })
  },

  setActiveSession: (sessionId) => {
    set({ activeSessionId: sessionId })
    if (sessionId) get().markRead(sessionId)
  },

  markRead: (sessionId) =>
    set(state => ({
      sessions: {
        ...state.sessions,
        [sessionId]: { ...state.sessions[sessionId]!, hasUnread: false }
      }
    }))
}))
