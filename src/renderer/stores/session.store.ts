import { create } from 'zustand'
import type { TerminalSession } from '../../shared/types/index'

interface SessionState {
  sessions: Map<string, TerminalSession>
  terminalInstances: Map<string, unknown>
  activeSessionIdByProject: Map<string, string>
  bellCounts: Map<string, number>

  createSession: (
    projectId: string,
    type: 'human' | 'agent',
    title: string,
    cwd: string,
    scrollbackLimit: number
  ) => Promise<string>
  closeSession: (sessionId: string) => Promise<void>
  getSessionsForProject: (projectId: string) => TerminalSession[]
  setTerminalInstance: (sessionId: string, terminal: unknown) => void
  getTerminalInstance: (sessionId: string) => unknown
  setActiveSessionForProject: (projectId: string, sessionId: string) => void
  getActiveSessionForProject: (projectId: string) => string | null
  handleProcessExit: (sessionId: string, exitCode: number) => void
  incrementBellCount: (sessionId: string) => void
  clearBellCount: (sessionId: string) => void
  getBellCountForSession: (sessionId: string) => number
  getBellCountForProject: (projectId: string) => number
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: new Map(),
  terminalInstances: new Map(),
  activeSessionIdByProject: new Map(),
  bellCounts: new Map(),

  createSession: async (projectId, type, title, cwd, scrollbackLimit) => {
    const result = await window.electronAPI.terminal.create({
      projectId,
      type,
      tabTitle: title,
      scrollbackLimit,
      cwd,
    })
    if ('error' in result) throw new Error(result.error)

    const { sessionId } = result
    const session: TerminalSession = {
      id: sessionId,
      projectId,
      tabTitle: title,
      status: 'active',
      type,
      scrollbackLimit,
      createdAt: new Date().toISOString(),
    }

    set((s) => {
      const sessions = new Map(s.sessions)
      sessions.set(sessionId, session)
      return { sessions }
    })

    return sessionId
  },

  closeSession: async (sessionId) => {
    // Dispose xterm instance before removing from store
    const instance = get().terminalInstances.get(sessionId) as { dispose?: () => void } | undefined
    instance?.dispose?.()
    await window.electronAPI.terminal.close(sessionId)
    set((s) => {
      const sessions = new Map(s.sessions)
      const session = sessions.get(sessionId)
      sessions.delete(sessionId)
      const terminalInstances = new Map(s.terminalInstances)
      terminalInstances.delete(sessionId)
      const bellCounts = new Map(s.bellCounts)
      bellCounts.delete(sessionId)
      const activeMap = new Map(s.activeSessionIdByProject)
      if (session) {
        if (activeMap.get(session.projectId) === sessionId) {
          const remaining = get()
            .getSessionsForProject(session.projectId)
            .filter((s) => s.id !== sessionId)
          if (remaining.length > 0) activeMap.set(session.projectId, remaining[0].id)
          else activeMap.delete(session.projectId)
        }
      }
      return { sessions, terminalInstances, activeSessionIdByProject: activeMap, bellCounts }
    })
  },

  getSessionsForProject: (projectId) => {
    return [...get().sessions.values()].filter((s) => s.projectId === projectId)
  },

  setTerminalInstance: (sessionId, terminal) => {
    set((s) => {
      const map = new Map(s.terminalInstances)
      map.set(sessionId, terminal)
      return { terminalInstances: map }
    })
  },

  getTerminalInstance: (sessionId) => get().terminalInstances.get(sessionId),

  setActiveSessionForProject: (projectId, sessionId) => {
    set((s) => {
      const map = new Map(s.activeSessionIdByProject)
      map.set(projectId, sessionId)
      const sessions = new Map(s.sessions)
      for (const [id, session] of sessions) {
        if (session.projectId === projectId) {
          sessions.set(id, { ...session, status: id === sessionId ? 'active' : 'backgrounded' })
        }
      }
      const bellCounts = new Map(s.bellCounts)
      bellCounts.delete(sessionId)
      return { activeSessionIdByProject: map, sessions, bellCounts }
    })
  },

  getActiveSessionForProject: (projectId) => get().activeSessionIdByProject.get(projectId) ?? null,

  incrementBellCount: (sessionId) => {
    set((s) => {
      const bellCounts = new Map(s.bellCounts)
      bellCounts.set(sessionId, (bellCounts.get(sessionId) ?? 0) + 1)
      return { bellCounts }
    })
  },

  clearBellCount: (sessionId) => {
    set((s) => {
      if (!s.bellCounts.has(sessionId)) return s
      const bellCounts = new Map(s.bellCounts)
      bellCounts.delete(sessionId)
      return { bellCounts }
    })
  },

  getBellCountForSession: (sessionId) => get().bellCounts.get(sessionId) ?? 0,

  getBellCountForProject: (projectId) => {
    const { sessions, bellCounts } = get()
    let total = 0
    for (const [id, session] of sessions)
      if (session.projectId === projectId) total += bellCounts.get(id) ?? 0
    return total
  },

  handleProcessExit: (sessionId, _exitCode) => {
    set((s) => {
      const sessions = new Map(s.sessions)
      const session = sessions.get(sessionId)
      if (session) {
        sessions.set(sessionId, {
          ...session,
          status: 'closed',
          closedAt: new Date().toISOString(),
          tabTitle: `${session.tabTitle} [exited]`,
        })
      }
      return { sessions }
    })
  },
}))
