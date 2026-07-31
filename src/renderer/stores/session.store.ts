import { create } from 'zustand'
import type { TerminalSession, PaneNode, PaneSplitDirection } from '../../shared/types/index'
import { SCRATCH_PROJECT_ID } from '../../shared/types/index'
import { splitLeaf, removeLeaf, leafIds, updateSplitRatio } from '../utils/pane-tree'
import type { TerminalInstance } from '../components/terminal/TerminalSession'

/**
 * Everything one project's terminal area needs to render: which tab is
 * active, which split pane is focused, the pane layout, tab order, and the
 * monotonically increasing "Terminal N" counter. One aggregate instead of
 * five parallel maps — removing or moving a session reconciles it in exactly
 * one place (detachSessionFromView).
 */
export interface ProjectView {
  activeSessionId?: string
  focusedSessionId?: string
  paneLayout?: PaneNode
  order?: string[]
  terminalCounter: number
}

const EMPTY_VIEW: ProjectView = { terminalCounter: 0 }

function viewOf(views: Map<string, ProjectView>, projectId: string): ProjectView {
  return views.get(projectId) ?? EMPTY_VIEW
}

/** Writes a view back, dropping it entirely when it holds nothing. */
function normalizeView(
  views: Map<string, ProjectView>,
  projectId: string,
  view: ProjectView
): void {
  const empty =
    view.activeSessionId === undefined &&
    view.focusedSessionId === undefined &&
    view.paneLayout === undefined &&
    (view.order === undefined || view.order.length === 0) &&
    view.terminalCounter === 0
  if (empty) views.delete(projectId)
  else views.set(projectId, view)
}

/**
 * THE reconciliation for a session leaving a project (close or move away):
 * prunes it from the layout, order, active, and focused slots, and picks the
 * survivors. `remainingOrderedIds` is the project's session list (in display
 * order) WITHOUT the departing session. closeSplitLeaf is deliberately NOT
 * expressed through this — unsplitting keeps the session in the project and
 * has its own survivor rule (the collapsed pane's remaining leaf activates).
 */
function detachSessionFromView(
  view: ProjectView,
  sessionId: string,
  remainingOrderedIds: string[]
): ProjectView {
  const next: ProjectView = { ...view }

  // Layout: drop the leaf; a layout with ≤1 leaf collapses to single-pane mode.
  if (next.paneLayout && leafIds(next.paneLayout).includes(sessionId)) {
    const pruned = removeLeaf(next.paneLayout, sessionId)
    next.paneLayout = pruned && leafIds(pruned).length > 1 ? pruned : undefined
  }

  // Order: filter the departing session out.
  if (next.order) {
    const filtered = next.order.filter((id) => id !== sessionId)
    next.order = filtered.length > 0 ? filtered : undefined
  }

  // Active: first remaining tab in display order.
  if (next.activeSessionId === sessionId) {
    next.activeSessionId = remainingOrderedIds[0]
  }

  // Focused: only meaningful while a split layout exists.
  if (next.focusedSessionId === sessionId || !next.paneLayout) {
    next.focusedSessionId = next.paneLayout ? leafIds(next.paneLayout)[0] : undefined
  }

  return next
}

function orderedSessionsForProject(
  sessions: Map<string, TerminalSession>,
  views: Map<string, ProjectView>,
  projectId: string
): TerminalSession[] {
  const all = [...sessions.values()].filter((s) => s.projectId === projectId)
  const order = views.get(projectId)?.order
  if (!order) return all
  const byId = new Map(all.map((s) => [s.id, s]))
  const ordered = order.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
  const untracked = all.filter((s) => !order.includes(s.id))
  return [...ordered, ...untracked]
}

interface SessionState {
  sessions: Map<string, TerminalSession>
  terminalInstances: Map<string, TerminalInstance>
  projectViews: Map<string, ProjectView>

  createSession: (
    projectId: string,
    type: 'human' | 'agent',
    title: string,
    cwd: string,
    scrollbackLimit: number,
    parentSessionId?: string
  ) => Promise<string>
  /**
   * Takes ownership of a terminal the main process already spawned.
   *
   * A supervised session's terminal is created there, because that is where
   * the agent is started from. Without adopting it the PTY runs and no tab
   * ever shows it, which is exactly the invisible agent this runtime replaced.
   */
  adoptSession: (session: {
    sessionId: string
    projectId: string
    tabTitle: string
    scrollbackLimit: number
  }) => void
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

function patchSession(
  s: Pick<SessionState, 'sessions'>,
  sessionId: string,
  patch: Partial<TerminalSession>
): { sessions: Map<string, TerminalSession> } | null {
  const session = s.sessions.get(sessionId)
  if (!session) return null
  const sessions = new Map(s.sessions)
  sessions.set(sessionId, { ...session, ...patch })
  return { sessions }
}

function patchView(
  s: Pick<SessionState, 'projectViews'>,
  projectId: string,
  patch: Partial<ProjectView>
): { projectViews: Map<string, ProjectView> } {
  const projectViews = new Map(s.projectViews)
  normalizeView(projectViews, projectId, { ...viewOf(projectViews, projectId), ...patch })
  return { projectViews }
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: new Map(),
  terminalInstances: new Map(),
  projectViews: new Map(),

  createSession: async (projectId, type, title, cwd, scrollbackLimit, parentSessionId) => {
    let resolvedTitle = title
    if (!resolvedTitle) {
      const next = viewOf(get().projectViews, projectId).terminalCounter + 1
      set((s) => patchView(s, projectId, { terminalCounter: next }))
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
      const view = viewOf(s.projectViews, projectId)
      const projectViews = new Map(s.projectViews)
      if (view.order) {
        projectViews.set(projectId, { ...view, order: [...view.order, sessionId] })
      }
      return { sessions, projectViews }
    })

    return sessionId
  },

  adoptSession: ({ sessionId, projectId, tabTitle, scrollbackLimit }) => {
    // Idempotent: a re-sent notification must not produce a second tab for one
    // terminal.
    if (get().sessions.has(sessionId)) return
    const session: TerminalSession = {
      id: sessionId,
      projectId,
      tabTitle,
      status: 'active',
      type: 'agent',
      scrollbackLimit,
      createdAt: new Date().toISOString(),
    }
    set((s) => {
      const sessions = new Map(s.sessions)
      sessions.set(sessionId, session)
      const view = viewOf(s.projectViews, projectId)
      const projectViews = new Map(s.projectViews)
      projectViews.set(projectId, {
        ...view,
        ...(view.order ? { order: [...view.order, sessionId] } : {}),
        // Made active when the project has nothing showing. Without this the
        // tab exists and no pane is ever mounted, so opening the project shows
        // an empty project rather than the agent that is running in it.
        activeSessionId: view.activeSessionId ?? sessionId,
      })
      return { sessions, projectViews }
    })
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
      const session = s.sessions.get(sessionId)
      const sessions = new Map(s.sessions)
      sessions.delete(sessionId)
      const terminalInstances = new Map(s.terminalInstances)
      terminalInstances.delete(sessionId)

      const projectViews = new Map(s.projectViews)
      if (session) {
        const remaining = orderedSessionsForProject(sessions, projectViews, session.projectId)
        const view = detachSessionFromView(
          viewOf(projectViews, session.projectId),
          sessionId,
          remaining.map((r) => r.id)
        )
        normalizeView(projectViews, session.projectId, view)
      }

      return { sessions, terminalInstances, projectViews }
    })
  },

  getSessionsForProject: (projectId) =>
    orderedSessionsForProject(get().sessions, get().projectViews, projectId),

  getScratchSessions: () => {
    return get().getSessionsForProject(SCRATCH_PROJECT_ID)
  },

  moveSession: (sessionId, targetProjectId) => {
    set((s) => {
      const session = s.sessions.get(sessionId)
      if (!session) return s
      const oldProjectId = session.projectId

      const sessions = new Map(s.sessions)
      sessions.set(sessionId, { ...session, projectId: targetProjectId })

      const projectViews = new Map(s.projectViews)
      // Leaving the old project: same reconciliation as closing there.
      const remaining = orderedSessionsForProject(sessions, projectViews, oldProjectId)
      const oldView = detachSessionFromView(
        viewOf(projectViews, oldProjectId),
        sessionId,
        remaining.map((r) => r.id)
      )
      normalizeView(projectViews, oldProjectId, oldView)

      // Arriving at the target: becomes active, appends to any explicit order.
      const targetView = { ...viewOf(projectViews, targetProjectId) }
      targetView.activeSessionId = sessionId
      if (targetView.order) targetView.order = [...targetView.order, sessionId]
      projectViews.set(targetProjectId, targetView)

      return { sessions, projectViews }
    })
  },

  reorderSessions: (projectId, orderedIds) => {
    set((s) => patchView(s, projectId, { order: orderedIds }))
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
      const sessions = new Map(s.sessions)
      for (const [id, session] of sessions) {
        if (session.projectId !== projectId) continue
        const status = id === sessionId ? ('active' as const) : ('backgrounded' as const)
        const bellCount = id === sessionId ? undefined : session.bellCount
        sessions.set(id, { ...session, status, bellCount })
      }
      return { sessions, ...patchView(s, projectId, { activeSessionId: sessionId }) }
    })
  },

  getActiveSessionForProject: (projectId) =>
    get().projectViews.get(projectId)?.activeSessionId ?? null,

  incrementBellCount: (sessionId) => {
    set((s) => {
      const session = s.sessions.get(sessionId)
      return patchSession(s, sessionId, { bellCount: (session?.bellCount ?? 0) + 1 }) ?? s
    })
  },

  clearBellCount: (sessionId) => {
    set((s) => {
      if (!s.sessions.get(sessionId)?.bellCount) return s
      return patchSession(s, sessionId, { bellCount: undefined }) ?? s
    })
  },

  getBellCountForSession: (sessionId) => get().sessions.get(sessionId)?.bellCount ?? 0,

  getBellCountForProject: (projectId) => {
    let total = 0
    for (const session of get().sessions.values())
      if (session.projectId === projectId) total += session.bellCount ?? 0
    return total
  },

  setSessionBusy: (sessionId) =>
    set((s) => {
      if (s.sessions.get(sessionId)?.busy) return s
      return patchSession(s, sessionId, { busy: true }) ?? s
    }),

  setSessionIdle: (sessionId) =>
    set((s) => {
      if (!s.sessions.get(sessionId)?.busy) return s
      return patchSession(s, sessionId, { busy: false }) ?? s
    }),

  isSessionBusy: (sessionId) => get().sessions.get(sessionId)?.busy ?? false,

  isProjectBusy: (projectId) => {
    for (const session of get().sessions.values())
      if (session.projectId === projectId && session.busy) return true
    return false
  },

  handleProcessExit: (sessionId, _exitCode) => {
    set((s) => {
      const session = s.sessions.get(sessionId)
      if (!session) return s
      return (
        patchSession(s, sessionId, {
          status: 'closed',
          closedAt: new Date().toISOString(),
          tabTitle: `${session.tabTitle} [exited]`,
        }) ?? s
      )
    })
  },

  renameSession: (sessionId, title) => {
    set((s) => patchSession(s, sessionId, { tabTitle: title }) ?? s)
  },

  getPaneLayout: (projectId) => get().projectViews.get(projectId)?.paneLayout ?? null,

  setSplitLayout: (projectId, layout) => {
    set((s) => patchView(s, projectId, { paneLayout: layout ?? undefined }))
  },

  activateSplit: (projectId, focusedId, newId, direction) => {
    set((s) => {
      const existing = s.projectViews.get(projectId)?.paneLayout
      const root: PaneNode = existing ?? { type: 'leaf', sessionId: focusedId }
      const newLayout = splitLeaf(root, focusedId, newId, direction)
      return patchView(s, projectId, { paneLayout: newLayout, focusedSessionId: newId })
    })
  },

  closeSplitLeaf: (projectId, sessionId) => {
    set((s) => {
      const view = s.projectViews.get(projectId)
      if (!view?.paneLayout) return s
      const pruned = removeLeaf(view.paneLayout, sessionId)
      const next: ProjectView = { ...view }
      if (!pruned || leafIds(pruned).length <= 1) {
        // Layout collapses to single-pane mode: the surviving leaf activates.
        next.paneLayout = undefined
        next.focusedSessionId = undefined
        const survivorId = pruned?.type === 'leaf' ? pruned.sessionId : undefined
        if (survivorId) next.activeSessionId = survivorId
      } else {
        next.paneLayout = pruned
        if (next.focusedSessionId === sessionId) {
          next.focusedSessionId = leafIds(pruned).filter((id) => id !== sessionId)[0]
        }
      }
      const projectViews = new Map(s.projectViews)
      normalizeView(projectViews, projectId, next)
      return { projectViews }
    })
  },

  setSplitRatio: (projectId, splitId, ratio) => {
    set((s) => {
      const layout = s.projectViews.get(projectId)?.paneLayout
      if (!layout) return s
      return patchView(s, projectId, { paneLayout: updateSplitRatio(layout, splitId, ratio) })
    })
  },

  getFocusedSession: (projectId) => get().projectViews.get(projectId)?.focusedSessionId ?? null,

  setFocusedSession: (projectId, sessionId) => {
    set((s) => patchView(s, projectId, { focusedSessionId: sessionId }))
  },
}))
