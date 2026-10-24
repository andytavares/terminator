import { create, type StoreApi } from 'zustand'
import type { ChoicePrompt, TerminalSession, PaneNode } from '../../shared/types/index'
import { SCRATCH_PROJECT_ID } from '../../shared/types/index'
import type { AgentAsk } from '../../shared/agent-sessions/ask'
import {
  splitLeaf,
  removeLeaf,
  leafIds,
  updateSplitRatio,
  type PaneSplit,
} from '../utils/pane-tree'
import type { TerminalInstance } from '../components/terminal/TerminalSession'

/**
 * Everything one project's terminal area needs to render: which tab is
 * active, which split pane is focused, each split tab's pane layout, tab
 * order, and the monotonically increasing "Terminal N" counter. One aggregate instead of
 * five parallel maps — removing or moving a session reconciles it in exactly
 * one place (detachSessionFromView).
 */
interface ProjectView {
  activeSessionId?: string
  focusedSessionId?: string
  /** One per split tab: its root session and the panes split off it. The one on screen is the
   * one holding the active session; a tab with none shows alone. */
  paneLayouts?: PaneNode[]
  order?: string[]
  terminalCounter: number
}

const EMPTY_VIEW: ProjectView = { terminalCounter: 0 }

function viewOf(views: Map<string, ProjectView>, projectId: string): ProjectView {
  return views.get(projectId) ?? EMPTY_VIEW
}

/** The split holding `sessionId`, if one does. */
function layoutHolding(view: ProjectView, sessionId: string | undefined): PaneNode | undefined {
  if (sessionId === undefined) return undefined
  return view.paneLayouts?.find((layout) => leafIds(layout).includes(sessionId))
}

/** The view's layouts with `previous` swapped for `next`, or dropped when there is no `next`. */
function replaceLayout(
  view: ProjectView,
  previous: PaneNode | undefined,
  next: PaneNode | undefined
): PaneNode[] | undefined {
  const others = (view.paneLayouts ?? []).filter((layout) => layout !== previous)
  const layouts = next ? [...others, next] : others
  return layouts.length > 0 ? layouts : undefined
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
    view.paneLayouts === undefined &&
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
  const held = layoutHolding(next, sessionId)
  const pruned = held ? removeLeaf(held, sessionId) : null
  if (held) next.paneLayouts = replaceLayout(next, held, stillSplit(pruned))

  // Order: filter the departing session out.
  if (next.order) next.order = orderWithout(next.order, sessionId)

  // Active: what is left of its split, else the first remaining tab in display order.
  if (next.activeSessionId === sessionId) {
    next.activeSessionId = pruned ? leafIds(pruned)[0] : remainingOrderedIds[0]
  }
  return withFocusOnScreen(next, sessionId)
}

/** A pruned layout that still splits the tab, or undefined once one pane is left. */
function stillSplit(pruned: PaneNode | null): PaneNode | undefined {
  return pruned && leafIds(pruned).length > 1 ? pruned : undefined
}

function orderWithout(order: string[], sessionId: string): string[] | undefined {
  const filtered = order.filter((id) => id !== sessionId)
  return filtered.length > 0 ? filtered : undefined
}

/** Focused: only meaningful while a split is on screen. */
function withFocusOnScreen(view: ProjectView, departedId: string): ProjectView {
  const onScreen = layoutHolding(view, view.activeSessionId)
  if (view.focusedSessionId === departedId || !onScreen) {
    view.focusedSessionId = onScreen ? leafIds(onScreen)[0] : undefined
  }
  return view
}

/** Unsplitting: `sessionId` leaves the split `held`, and the session stays in the project. A
 * split left with one pane collapses and, when it was on screen, its remaining pane activates.
 * A split off screen changes nothing on screen. */
function withoutLeaf(view: ProjectView, held: PaneNode, sessionId: string): ProjectView {
  const onScreen = layoutHolding(view, view.activeSessionId) === held
  const pruned = removeLeaf(held, sessionId)
  const next: ProjectView = { ...view }
  if (!pruned || leafIds(pruned).length <= 1) {
    next.paneLayouts = replaceLayout(view, held, undefined)
    if (!onScreen) return next
    next.focusedSessionId = undefined
    if (pruned?.type === 'leaf') next.activeSessionId = pruned.sessionId
    return next
  }
  next.paneLayouts = replaceLayout(view, held, pruned)
  if (next.focusedSessionId === sessionId) next.focusedSessionId = leafIds(pruned)[0]
  // The split stays on screen when the pane closing was the active one.
  if (next.activeSessionId === sessionId) next.activeSessionId = leafIds(pruned)[0]
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

/** A terminal to open: where, of what kind, and under what title. */
export interface NewSessionRequest {
  projectId: string
  type: 'human' | 'agent'
  /** Empty for the next "Terminal N". */
  title: string
  cwd: string
  scrollbackLimit: number
  /** The session this one is a split pane of. */
  parentSessionId?: string
  /** One line run in the terminal once it opens, for a terminal that resumes a conversation. */
  initialCommand?: string
}

interface SessionState {
  sessions: Map<string, TerminalSession>
  terminalInstances: Map<string, TerminalInstance>
  projectViews: Map<string, ProjectView>

  createSession: (request: NewSessionRequest) => Promise<string>
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
  /** Forget a deleted project's tabs; the main process already ended them. */
  dropProjectSessions: (projectId: string) => void
  getSessionsForProject: (projectId: string) => TerminalSession[]
  getScratchSessions: () => TerminalSession[]
  moveSession: (sessionId: string, targetProjectId: string) => void
  reorderSessions: (projectId: string, orderedIds: string[]) => void
  setTerminalInstance: (sessionId: string, terminal: TerminalInstance) => void
  getTerminalInstance: (sessionId: string) => TerminalInstance | undefined
  /** Records PTY activity. `now` is supplied by the caller so this stays pure. */
  stampActivity: (sessionId: string, now: number) => void
  setActiveSessionForProject: (projectId: string, sessionId: string, now?: number) => void
  getActiveSessionForProject: (projectId: string) => string | null
  handleProcessExit: (sessionId: string, exitCode: number | null) => void
  incrementBellCount: (sessionId: string) => void
  clearBellCount: (sessionId: string) => void
  clearInferredAsk: (sessionId: string) => void
  getBellCountForSession: (sessionId: string) => number
  getBellCountForProject: (projectId: string) => number
  setSessionBusy: (sessionId: string) => void
  setSessionIdle: (sessionId: string) => void
  /** What the agent says it is waiting on, or null once it is answered. */
  setAgentAsk: (sessionId: string, ask: AgentAsk | null) => void
  setAgentTurn: (sessionId: string, inTurn: boolean) => void
  /** What a session's screen showed when its output last settled. */
  setSessionScreen: (
    sessionId: string,
    screen: { latestLine: string; choicePrompt: ChoicePrompt | null }
  ) => void
  isSessionBusy: (sessionId: string) => boolean
  isProjectBusy: (projectId: string) => boolean
  renameSession: (sessionId: string, title: string) => void

  /** The split of the tab on screen; null when that tab shows alone. */
  getPaneLayout: (projectId: string) => PaneNode | null
  /** Splits `split.targetId` in the project's tab, focusing the new pane. */
  activateSplit: (projectId: string, split: PaneSplit) => void
  closeSplitLeaf: (projectId: string, sessionId: string) => void
  setSplitRatio: (projectId: string, splitId: string, ratio: number) => void
  /** The focused pane of the split on screen; null when that tab shows alone. */
  getFocusedSession: (projectId: string) => string | null
  setFocusedSession: (projectId: string, sessionId: string) => void

  /**
   * A session that wants the keyboard, independent of whether it just became
   * active. The nonce is what a pane's effect keys off — bumping it even when
   * `sessionId` repeats is how "click the row that's already active" still
   * moves focus off wherever it was (a div, another pane).
   */
  focusRequest: { sessionId: string; nonce: number } | null
  requestFocus: (sessionId: string) => void
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

type SetSessions = StoreApi<SessionState>['setState']
type GetSessions = StoreApi<SessionState>['getState']
type SessionData = Pick<SessionState, 'sessions' | 'terminalInstances' | 'projectViews'>

/** The request's title, or the project's next "Terminal N", counting it. */
function resolveTitle(set: SetSessions, get: GetSessions, request: NewSessionRequest): string {
  if (request.title) return request.title
  const next = viewOf(get().projectViews, request.projectId).terminalCounter + 1
  set((s) => patchView(s, request.projectId, { terminalCounter: next }))
  return `Terminal ${next}`
}

function newSessionRecord(
  request: NewSessionRequest,
  tabTitle: string,
  { sessionId, shell }: { sessionId: string; shell?: string }
): TerminalSession {
  const createdAt = new Date().toISOString()
  return {
    id: sessionId,
    projectId: request.projectId,
    tabTitle,
    status: 'active',
    type: request.type,
    scrollbackLimit: request.scrollbackLimit,
    createdAt,
    parentSessionId: request.parentSessionId,
    // A session with no recorded activity is treated as last active when it
    // was created, so recency is representable from the first render (FR-007).
    lastActivityAt: Date.parse(createdAt),
    agentState: 'idle',
    ...(shell === undefined ? {} : { shell }),
  }
}

/** Adds the session, appending it to its project's order when one is kept. */
function withSessionAdded(s: SessionData, session: TerminalSession): Partial<SessionData> {
  const sessions = new Map(s.sessions)
  sessions.set(session.id, session)
  const view = viewOf(s.projectViews, session.projectId)
  const projectViews = new Map(s.projectViews)
  if (view.order) {
    projectViews.set(session.projectId, { ...view, order: [...view.order, session.id] })
  }
  return { sessions, projectViews }
}

async function createSession(
  set: SetSessions,
  get: GetSessions,
  request: NewSessionRequest
): Promise<string> {
  const tabTitle = resolveTitle(set, get, request)
  const { projectId, type, scrollbackLimit, cwd, initialCommand } = request
  const result = await window.electronAPI.terminal.create({
    ...{ projectId, type, tabTitle, scrollbackLimit, cwd },
    ...(initialCommand === undefined ? {} : { initialCommand }),
  })
  // The message when there is one: 'CWD_MISSING' names the failure, but only
  // the message names the folder, and the folder is the whole answer.
  if ('error' in result) throw new Error(result.message ?? result.error)
  const session = newSessionRecord(request, tabTitle, result)
  set((s) => withSessionAdded(s, session))
  return result.sessionId
}

type Adopted = Parameters<SessionState['adoptSession']>[0]

function adoptedSession(s: SessionData, adopted: Adopted): Partial<SessionData> {
  const createdAt = new Date().toISOString()
  const session: TerminalSession = {
    id: adopted.sessionId,
    projectId: adopted.projectId,
    tabTitle: adopted.tabTitle,
    status: 'active',
    type: 'agent',
    scrollbackLimit: adopted.scrollbackLimit,
    createdAt,
    lastActivityAt: Date.parse(createdAt),
    agentState: 'idle',
  }
  const added = withSessionAdded(s, session)
  const projectViews = new Map(added.projectViews)
  const view = viewOf(projectViews, adopted.projectId)
  // Made active when the project has nothing showing. Without this the
  // tab exists and no pane is ever mounted, so opening the project shows
  // an empty project rather than the agent that is running in it.
  projectViews.set(adopted.projectId, {
    ...view,
    activeSessionId: view.activeSessionId ?? adopted.sessionId,
  })
  return { ...added, projectViews }
}

function withoutProject(s: SessionData, projectId: string): Partial<SessionData> {
  const sessions = new Map(s.sessions)
  const terminalInstances = new Map(s.terminalInstances)
  for (const session of s.sessions.values()) {
    if (session.projectId !== projectId) continue
    terminalInstances.get(session.id)?.dispose?.()
    terminalInstances.delete(session.id)
    sessions.delete(session.id)
  }
  const projectViews = new Map(s.projectViews)
  projectViews.delete(projectId)
  return { sessions, terminalInstances, projectViews }
}

/** Reconciles the project's view for a session that has left it. */
function detachFrom(
  projectViews: Map<string, ProjectView>,
  sessions: Map<string, TerminalSession>,
  departed: { sessionId: string; projectId: string }
): void {
  const remaining = orderedSessionsForProject(sessions, projectViews, departed.projectId)
  const view = detachSessionFromView(
    viewOf(projectViews, departed.projectId),
    departed.sessionId,
    remaining.map((r) => r.id)
  )
  normalizeView(projectViews, departed.projectId, view)
}

function withoutSession(s: SessionData, sessionId: string): Partial<SessionData> {
  const session = s.sessions.get(sessionId)
  const sessions = new Map(s.sessions)
  sessions.delete(sessionId)
  const terminalInstances = new Map(s.terminalInstances)
  terminalInstances.delete(sessionId)
  const projectViews = new Map(s.projectViews)
  if (session) detachFrom(projectViews, sessions, { sessionId, projectId: session.projectId })
  return { sessions, terminalInstances, projectViews }
}

async function closeSession(set: SetSessions, get: GetSessions, sessionId: string): Promise<void> {
  // Close any split children that belong to this session before closing the parent
  const children = [...get().sessions.values()].filter((s) => s.parentSessionId === sessionId)
  for (const child of children) {
    await get().closeSession(child.id)
  }
  // Dispose xterm instance before removing from store
  const instance = get().terminalInstances.get(sessionId)
  instance?.dispose?.()
  await window.electronAPI.terminal.close(sessionId)
  set((s) => withoutSession(s, sessionId))
}

function movedSession(
  s: SessionData,
  sessionId: string,
  targetProjectId: string
): Partial<SessionData> {
  const session = s.sessions.get(sessionId)
  if (!session) return s
  const sessions = new Map(s.sessions)
  sessions.set(sessionId, { ...session, projectId: targetProjectId })

  const projectViews = new Map(s.projectViews)
  // Leaving the old project: same reconciliation as closing there.
  detachFrom(projectViews, sessions, { sessionId, projectId: session.projectId })

  // Arriving at the target: becomes active, appends to any explicit order.
  const targetView = { ...viewOf(projectViews, targetProjectId) }
  targetView.activeSessionId = sessionId
  if (targetView.order) targetView.order = [...targetView.order, sessionId]
  projectViews.set(targetProjectId, targetView)

  return { sessions, projectViews }
}

/** The shown tab becomes active and attended; the project's others go to the background. */
function activatedSession(
  s: SessionData,
  shown: { projectId: string; sessionId: string },
  now: number
): Partial<SessionData> {
  const sessions = new Map(s.sessions)
  for (const [id, session] of sessions) {
    if (session.projectId !== shown.projectId) continue
    const isActive = id === shown.sessionId
    // An exited terminal stays closed whichever tab is shown.
    const status =
      session.status === 'closed' ? session.status : isActive ? 'active' : 'backgrounded'
    sessions.set(id, {
      ...session,
      status,
      bellCount: isActive ? undefined : session.bellCount,
      ...(isActive ? { lastAttendedAt: now } : {}),
    })
  }
  return { sessions, ...patchView(s, shown.projectId, { activeSessionId: shown.sessionId }) }
}

function exitedSession(s: SessionData, sessionId: string): Partial<SessionData> {
  const session = s.sessions.get(sessionId)
  if (!session) return s
  return (
    patchSession(s, sessionId, {
      status: 'closed',
      closedAt: new Date().toISOString(),
      tabTitle: `${session.tabTitle} [exited]`,
    }) ?? s
  )
}

function splitIn(s: SessionData, projectId: string, split: PaneSplit): Partial<SessionData> {
  const view = viewOf(s.projectViews, projectId)
  const existing = layoutHolding(view, split.targetId)
  const root: PaneNode = existing ?? { type: 'leaf', sessionId: split.targetId }
  return patchView(s, projectId, {
    paneLayouts: replaceLayout(view, existing, splitLeaf(root, split)),
    focusedSessionId: split.newId,
  })
}

function unsplitIn(s: SessionData, projectId: string, sessionId: string): Partial<SessionData> {
  const view = s.projectViews.get(projectId)
  const held = view && layoutHolding(view, sessionId)
  if (!view || !held) return s
  const projectViews = new Map(s.projectViews)
  normalizeView(projectViews, projectId, withoutLeaf(view, held, sessionId))
  return { projectViews }
}

function focusedOnScreen(view: ProjectView): string | null {
  const focused = view.focusedSessionId
  const onScreen = layoutHolding(view, view.activeSessionId)
  return focused && onScreen && leafIds(onScreen).includes(focused) ? focused : null
}

type Slice<Keys extends keyof SessionState> = Pick<SessionState, Keys>

/** Opening, adopting, moving, ordering and closing tabs. */
function lifecycleSlice(
  set: SetSessions,
  get: GetSessions
): Slice<
  | 'createSession'
  | 'adoptSession'
  | 'dropProjectSessions'
  | 'closeSession'
  | 'moveSession'
  | 'reorderSessions'
  | 'handleProcessExit'
  | 'renameSession'
> {
  return {
    createSession: (request) => createSession(set, get, request),
    adoptSession: (adopted) => {
      // Idempotent: a re-sent notification must not produce a second tab for one
      // terminal.
      if (get().sessions.has(adopted.sessionId)) return
      set((s) => adoptedSession(s, adopted))
    },
    dropProjectSessions: (projectId) => set((s) => withoutProject(s, projectId)),
    closeSession: (sessionId) => closeSession(set, get, sessionId),
    moveSession: (sessionId, target) => set((s) => movedSession(s, sessionId, target)),
    reorderSessions: (projectId, orderedIds) =>
      set((s) => patchView(s, projectId, { order: orderedIds })),
    handleProcessExit: (sessionId) => set((s) => exitedSession(s, sessionId)),
    renameSession: (sessionId, title) =>
      set((s) => patchSession(s, sessionId, { tabTitle: title }) ?? s),
  }
}

/** What the tabs show and what they ask for: the active tab, bells, busy and the screen. */
function activitySlice(
  set: SetSessions
): Slice<'stampActivity' | 'setActiveSessionForProject' | 'setSessionScreen'> {
  return {
    stampActivity: (sessionId, now) =>
      set((s) => patchSession(s, sessionId, { lastActivityAt: now }) ?? s),
    setActiveSessionForProject: (projectId, sessionId, now = Date.now()) =>
      set((s) => activatedSession(s, { projectId, sessionId }, now)),
    setSessionScreen: (sessionId, { latestLine, choicePrompt }) =>
      set(
        (s) =>
          patchSession(s, sessionId, { latestLine, choicePrompt: choicePrompt ?? undefined }) ?? s
      ),
  }
}

/** The xterm behind each tab, and the tab that wants the keyboard. */
function terminalSlice(set: SetSessions): Slice<'setTerminalInstance' | 'requestFocus'> {
  return {
    setTerminalInstance: (sessionId, terminal) =>
      set((s) => ({ terminalInstances: new Map(s.terminalInstances).set(sessionId, terminal) })),
    requestFocus: (sessionId) =>
      set((s) => ({ focusRequest: { sessionId, nonce: (s.focusRequest?.nonce ?? 0) + 1 } })),
  }
}

/** The bell, and busy and idle, which flip on every burst of output and so write only on a change. */
function signalSlice(
  set: SetSessions
): Slice<'incrementBellCount' | 'clearBellCount' | 'setSessionBusy' | 'setSessionIdle'> {
  return {
    incrementBellCount: (sessionId) =>
      set((s) => {
        const bellCount = (s.sessions.get(sessionId)?.bellCount ?? 0) + 1
        return patchSession(s, sessionId, { bellCount }) ?? s
      }),
    clearBellCount: (sessionId) =>
      set((s) => {
        if (!s.sessions.get(sessionId)?.bellCount) return s
        return patchSession(s, sessionId, { bellCount: undefined }) ?? s
      }),
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
  }
}

/** What a session's agent says it is waiting on. */
function agentAskSlice(set: SetSessions): Slice<'setAgentAsk'> {
  return {
    setAgentAsk: (sessionId, ask) =>
      set((s) => patchSession(s, sessionId, { agentAsk: ask ?? undefined }) ?? s),
  }
}

/** Typing answers whatever the bell or the on-screen choice seemed to ask. */
function inferredAskSlice(set: SetSessions): Slice<'clearInferredAsk'> {
  return {
    clearInferredAsk: (sessionId) =>
      set((s) => {
        const session = s.sessions.get(sessionId)
        if (!session?.bellCount && session?.choicePrompt === undefined) return s
        return patchSession(s, sessionId, { bellCount: undefined, choicePrompt: undefined }) ?? s
      }),
  }
}

/** Whether a session's agent is mid-turn, as its hooks report. */
function agentTurnSlice(set: SetSessions): Slice<'setAgentTurn'> {
  return {
    setAgentTurn: (sessionId, inTurn) =>
      set((s) => patchSession(s, sessionId, { agentTurn: inTurn }) ?? s),
  }
}

/** Reads over the sessions and their views. */
function querySlice(
  get: GetSessions
): Slice<
  | 'getSessionsForProject'
  | 'getScratchSessions'
  | 'getTerminalInstance'
  | 'getActiveSessionForProject'
  | 'getBellCountForSession'
  | 'getBellCountForProject'
  | 'isSessionBusy'
  | 'isProjectBusy'
> {
  const inProject = (projectId: string) =>
    [...get().sessions.values()].filter((session) => session.projectId === projectId)
  return {
    getSessionsForProject: (projectId) =>
      orderedSessionsForProject(get().sessions, get().projectViews, projectId),
    getScratchSessions: () => get().getSessionsForProject(SCRATCH_PROJECT_ID),
    getTerminalInstance: (sessionId) => get().terminalInstances.get(sessionId),
    getActiveSessionForProject: (projectId) =>
      get().projectViews.get(projectId)?.activeSessionId ?? null,
    getBellCountForSession: (sessionId) => get().sessions.get(sessionId)?.bellCount ?? 0,
    getBellCountForProject: (projectId) =>
      inProject(projectId).reduce((total, session) => total + (session.bellCount ?? 0), 0),
    isSessionBusy: (sessionId) => get().sessions.get(sessionId)?.busy ?? false,
    isProjectBusy: (projectId) => inProject(projectId).some((session) => session.busy),
  }
}

/** The split panes of each tab, and which one is focused. */
function splitSlice(
  set: SetSessions,
  get: GetSessions
): Slice<
  | 'getPaneLayout'
  | 'activateSplit'
  | 'closeSplitLeaf'
  | 'setSplitRatio'
  | 'getFocusedSession'
  | 'setFocusedSession'
> {
  return {
    getPaneLayout: (projectId) => {
      const view = viewOf(get().projectViews, projectId)
      return layoutHolding(view, view.activeSessionId) ?? null
    },
    activateSplit: (projectId, split) => set((s) => splitIn(s, projectId, split)),
    closeSplitLeaf: (projectId, sessionId) => set((s) => unsplitIn(s, projectId, sessionId)),
    setSplitRatio: (projectId, splitId, ratio) =>
      set((s) => {
        const layouts = s.projectViews.get(projectId)?.paneLayouts
        if (!layouts) return s
        const paneLayouts = layouts.map((layout) => updateSplitRatio(layout, splitId, ratio))
        return patchView(s, projectId, { paneLayouts })
      }),
    getFocusedSession: (projectId) => focusedOnScreen(viewOf(get().projectViews, projectId)),
    setFocusedSession: (projectId, sessionId) =>
      set((s) => patchView(s, projectId, { focusedSessionId: sessionId })),
  }
}

// One store built from slices, each a group of actions over the same state:
// https://zustand.docs.pmnd.rs/guides/slices-pattern
export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: new Map(),
  terminalInstances: new Map(),
  projectViews: new Map(),
  focusRequest: null,
  ...lifecycleSlice(set, get),
  ...activitySlice(set),
  ...terminalSlice(set),
  ...signalSlice(set),
  ...agentAskSlice(set),
  ...agentTurnSlice(set),
  ...inferredAskSlice(set),
  ...querySlice(get),
  ...splitSlice(set, get),
}))
