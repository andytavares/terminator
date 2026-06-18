import { create } from 'zustand'
import type { TerminalSession, PaneNode, PaneSplitDirection } from '../../shared/types/index'
import { SCRATCH_PROJECT_ID } from '../../shared/types/index'
import { splitLeaf, removeLeaf, leafIds, updateSplitRatio } from '../utils/pane-tree'
import type { TerminalInstance } from '../components/terminal/TerminalSession'

interface SessionState {
  sessions: Map<string, TerminalSession>
  terminalInstances: Map<string, TerminalInstance>
  activeSessionIdByProject: Map<string, string>
  bellCounts: Map<string, number>
  busySessions: Set<string>
  terminalCountByProject: Map<string, number>
  paneLayoutByProject: Map<string, PaneNode>
  focusedSessionByProject: Map<string, string>
  sessionOrderByProject: Map<string, string[]>

  createSession: (
    projectId: string,
    type: 'human' | 'agent',
    title: string,
    cwd: string,
    scrollbackLimit: number,
    parentSessionId?: string
  ) => Promise<string>
  closeSession: (sessionId: string) => Promise<void>
  getSessionsForProject: (projectId: string) => TerminalSession[]
  getScratchSessions: () => TerminalSession[]
  moveSession: (sessionId: string, targetProjectId: string) => void
  reorderSessions: (projectId: string, orderedIds: string[]) => void
  setTerminalInstance: (sessionId: string, terminal: TerminalInstance) => void
  getTerminalInstance: (sessionId: string) => TerminalInstance | undefined
  setActiveSessionForProject: (projectId: string, sessionId: string) => void
  getActiveSessionForProject: (projectId: string) => string | null
  handleProcessExit: (sessionId: string, exitCode: number) => void
  incrementBellCount: (sessionId: string) => void
  clearBellCount: (sessionId: string) => void
  getBellCountForSession: (sessionId: string) => number
  getBellCountForProject: (projectId: string) => number
  setSessionBusy: (sessionId: string) => void
  setSessionIdle: (sessionId: string) => void
  isSessionBusy: (sessionId: string) => boolean
  isProjectBusy: (projectId: string) => boolean
  renameSession: (sessionId: string, title: string) => void

  getPaneLayout: (projectId: string) => PaneNode | null
  setSplitLayout: (projectId: string, layout: PaneNode | null) => void
  activateSplit: (
    projectId: string,
    focusedId: string,
    newId: string,
    direction: PaneSplitDirection
  ) => void
  closeSplitLeaf: (projectId: string, sessionId: string) => void
  setSplitRatio: (projectId: string, splitId: string, ratio: number) => void
  getFocusedSession: (projectId: string) => string | null
  setFocusedSession: (projectId: string, sessionId: string) => void
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: new Map(),
  terminalInstances: new Map(),
  activeSessionIdByProject: new Map(),
  bellCounts: new Map(),
  busySessions: new Set(),
  terminalCountByProject: new Map(),
  paneLayoutByProject: new Map(),
  focusedSessionByProject: new Map(),
  sessionOrderByProject: new Map(),

  createSession: async (projectId, type, title, cwd, scrollbackLimit, parentSessionId) => {
    let resolvedTitle = title
    if (!resolvedTitle) {
      const counts = get().terminalCountByProject
      const next = (counts.get(projectId) ?? 0) + 1
      set((s) => {
        const terminalCountByProject = new Map(s.terminalCountByProject)
        terminalCountByProject.set(projectId, next)
        return { terminalCountByProject }
      })
      resolvedTitle = `Terminal ${next}`
    }

    const result = await window.electronAPI.terminal.create({
      projectId,
      type,
      tabTitle: resolvedTitle,
      scrollbackLimit,
      cwd,
    })
    if ('error' in result) throw new Error(result.error)

    const { sessionId } = result
    const session: TerminalSession = {
      id: sessionId,
      projectId,
      tabTitle: resolvedTitle,
      status: 'active',
      type,
      scrollbackLimit,
      createdAt: new Date().toISOString(),
      parentSessionId,
    }

    set((s) => {
      const sessions = new Map(s.sessions)
      sessions.set(sessionId, session)
      // Append to ordering if an explicit order exists for this project
      const sessionOrderByProject = new Map(s.sessionOrderByProject)
      const existing = sessionOrderByProject.get(projectId)
      if (existing) sessionOrderByProject.set(projectId, [...existing, sessionId])
      return { sessions, sessionOrderByProject }
    })

    return sessionId
  },

  closeSession: async (sessionId) => {
    // Close any split children that belong to this session before closing the parent
    const children = [...get().sessions.values()].filter((s) => s.parentSessionId === sessionId)
    for (const child of children) {
      await get().closeSession(child.id)
    }
    // Dispose xterm instance before removing from store
    const instance = get().terminalInstances.get(sessionId)
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
      const busySessions = new Set(s.busySessions)
      busySessions.delete(sessionId)

      // Remove from any split layout
      const paneLayoutByProject = new Map(s.paneLayoutByProject)
      for (const [pid, layout] of paneLayoutByProject) {
        if (!leafIds(layout).includes(sessionId)) continue
        const newLayout = removeLeaf(layout, sessionId)
        if (!newLayout || leafIds(newLayout).length <= 1) paneLayoutByProject.delete(pid)
        else paneLayoutByProject.set(pid, newLayout)
      }
      // Remove stale focused session entry
      const focusedSessionByProject = new Map(s.focusedSessionByProject)
      if (session && focusedSessionByProject.get(session.projectId) === sessionId) {
        focusedSessionByProject.delete(session.projectId)
      }

      // Remove from session order
      const sessionOrderByProject = new Map(s.sessionOrderByProject)
      for (const [pid, order] of sessionOrderByProject) {
        const filtered = order.filter((id) => id !== sessionId)
        if (filtered.length !== order.length) {
          if (filtered.length > 0) sessionOrderByProject.set(pid, filtered)
          else sessionOrderByProject.delete(pid)
        }
      }

      return {
        sessions,
        terminalInstances,
        activeSessionIdByProject: activeMap,
        bellCounts,
        busySessions,
        paneLayoutByProject,
        focusedSessionByProject,
        sessionOrderByProject,
      }
    })
  },

  getSessionsForProject: (projectId) => {
    const all = [...get().sessions.values()].filter((s) => s.projectId === projectId)
    const order = get().sessionOrderByProject.get(projectId)
    if (!order) return all
    const byId = new Map(all.map((s) => [s.id, s]))
    const ordered = order.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
    const untracked = all.filter((s) => !order.includes(s.id))
    return [...ordered, ...untracked]
  },

  getScratchSessions: () => {
    return get().getSessionsForProject(SCRATCH_PROJECT_ID)
  },

  moveSession: (sessionId, targetProjectId) => {
    set((s) => {
      const sessions = new Map(s.sessions)
      const session = sessions.get(sessionId)
      if (!session) return s
      const oldProjectId = session.projectId

      sessions.set(sessionId, { ...session, projectId: targetProjectId })

      // Update activeSessionIdByProject
      const activeMap = new Map(s.activeSessionIdByProject)
      if (activeMap.get(oldProjectId) === sessionId) {
        const remaining = [...sessions.values()].filter(
          (x) => x.projectId === oldProjectId && x.id !== sessionId
        )
        if (remaining.length > 0) activeMap.set(oldProjectId, remaining[0].id)
        else activeMap.delete(oldProjectId)
      }
      activeMap.set(targetProjectId, sessionId)

      // Remove from old pane layout
      const paneLayoutByProject = new Map(s.paneLayoutByProject)
      const oldLayout = paneLayoutByProject.get(oldProjectId)
      if (oldLayout) {
        const newLayout = removeLeaf(oldLayout, sessionId)
        if (!newLayout || leafIds(newLayout).length <= 1) paneLayoutByProject.delete(oldProjectId)
        else paneLayoutByProject.set(oldProjectId, newLayout)
      }

      // Update session order
      const sessionOrderByProject = new Map(s.sessionOrderByProject)
      const oldOrder = sessionOrderByProject.get(oldProjectId)
      if (oldOrder) {
        const newOrder = oldOrder.filter((id) => id !== sessionId)
        if (newOrder.length > 0) sessionOrderByProject.set(oldProjectId, newOrder)
        else sessionOrderByProject.delete(oldProjectId)
      }
      const targetOrder = sessionOrderByProject.get(targetProjectId)
      if (targetOrder) sessionOrderByProject.set(targetProjectId, [...targetOrder, sessionId])

      // Update focused session
      const focusedSessionByProject = new Map(s.focusedSessionByProject)
      if (focusedSessionByProject.get(oldProjectId) === sessionId) {
        focusedSessionByProject.delete(oldProjectId)
      }

      return {
        sessions,
        activeSessionIdByProject: activeMap,
        paneLayoutByProject,
        sessionOrderByProject,
        focusedSessionByProject,
      }
    })
  },

  reorderSessions: (projectId, orderedIds) => {
    set((s) => {
      const sessionOrderByProject = new Map(s.sessionOrderByProject)
      sessionOrderByProject.set(projectId, orderedIds)
      return { sessionOrderByProject }
    })
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

  setSessionBusy: (sessionId) =>
    set((s) => {
      if (s.busySessions.has(sessionId)) return s
      const busySessions = new Set(s.busySessions)
      busySessions.add(sessionId)
      return { busySessions }
    }),

  setSessionIdle: (sessionId) =>
    set((s) => {
      if (!s.busySessions.has(sessionId)) return s
      const busySessions = new Set(s.busySessions)
      busySessions.delete(sessionId)
      return { busySessions }
    }),

  isSessionBusy: (sessionId) => get().busySessions.has(sessionId),

  isProjectBusy: (projectId) => {
    const { sessions, busySessions } = get()
    for (const [id, session] of sessions)
      if (session.projectId === projectId && busySessions.has(id)) return true
    return false
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

  renameSession: (sessionId, title) => {
    set((s) => {
      const sessions = new Map(s.sessions)
      const session = sessions.get(sessionId)
      if (!session) return s
      sessions.set(sessionId, { ...session, tabTitle: title })
      return { sessions }
    })
  },

  getPaneLayout: (projectId) => get().paneLayoutByProject.get(projectId) ?? null,

  setSplitLayout: (projectId, layout) => {
    set((s) => {
      const paneLayoutByProject = new Map(s.paneLayoutByProject)
      if (layout === null) paneLayoutByProject.delete(projectId)
      else paneLayoutByProject.set(projectId, layout)
      return { paneLayoutByProject }
    })
  },

  activateSplit: (projectId, focusedId, newId, direction) => {
    set((s) => {
      const existing = s.paneLayoutByProject.get(projectId)
      const root: PaneNode = existing ?? { type: 'leaf', sessionId: focusedId }
      const newLayout = splitLeaf(root, focusedId, newId, direction)
      const paneLayoutByProject = new Map(s.paneLayoutByProject)
      paneLayoutByProject.set(projectId, newLayout)
      const focusedSessionByProject = new Map(s.focusedSessionByProject)
      focusedSessionByProject.set(projectId, newId)
      return { paneLayoutByProject, focusedSessionByProject }
    })
  },

  closeSplitLeaf: (projectId, sessionId) => {
    set((s) => {
      const layout = s.paneLayoutByProject.get(projectId)
      if (!layout) return s
      const newLayout = removeLeaf(layout, sessionId)
      const paneLayoutByProject = new Map(s.paneLayoutByProject)
      if (!newLayout || leafIds(newLayout).length <= 1) {
        paneLayoutByProject.delete(projectId)
        // Activate the surviving leaf so single-pane mode shows it
        const survivorId = newLayout?.type === 'leaf' ? newLayout.sessionId : null
        const activeMap = new Map(s.activeSessionIdByProject)
        if (survivorId) activeMap.set(projectId, survivorId)
        const focusedSessionByProject = new Map(s.focusedSessionByProject)
        focusedSessionByProject.delete(projectId)
        return { paneLayoutByProject, activeSessionIdByProject: activeMap, focusedSessionByProject }
      }
      paneLayoutByProject.set(projectId, newLayout)
      const focusedSessionByProject = new Map(s.focusedSessionByProject)
      // Move focus to the first remaining leaf if we closed the focused one
      if (focusedSessionByProject.get(projectId) === sessionId) {
        const remaining = leafIds(newLayout).filter((id) => id !== sessionId)
        if (remaining.length > 0) focusedSessionByProject.set(projectId, remaining[0])
        else focusedSessionByProject.delete(projectId)
      }
      return { paneLayoutByProject, focusedSessionByProject }
    })
  },

  setSplitRatio: (projectId, splitId, ratio) => {
    set((s) => {
      const layout = s.paneLayoutByProject.get(projectId)
      if (!layout) return s
      const paneLayoutByProject = new Map(s.paneLayoutByProject)
      paneLayoutByProject.set(projectId, updateSplitRatio(layout, splitId, ratio))
      return { paneLayoutByProject }
    })
  },

  getFocusedSession: (projectId) => get().focusedSessionByProject.get(projectId) ?? null,

  setFocusedSession: (projectId, sessionId) => {
    set((s) => {
      const focusedSessionByProject = new Map(s.focusedSessionByProject)
      focusedSessionByProject.set(projectId, sessionId)
      return { focusedSessionByProject }
    })
  },
}))
