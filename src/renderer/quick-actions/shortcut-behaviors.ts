import { useWorkspaceStore } from '../stores/workspace.store'
import { useSessionStore } from '../stores/session.store'
import { useExtensionRegistry } from '../extensions/registry'
import { dispatchNotification } from '../lib/notifications'

/** Leaves whatever global/workspace/project tab is showing, the way every
 * "go to session" path must (see navigate-to-session.ts's revealSession). */
function clearTabsEverywhere(): void {
  const registry = useExtensionRegistry.getState()
  registry.setActiveGlobalTab(null)
  registry.setActiveWorkspaceTab(null)
  registry.setActiveProjectTab(null)
}

/**
 * The imperative bodies behind every direct terminal/session/workspace
 * shortcut. `useKeyboardShortcuts.ts` and `core-actions.ts` both call these
 * with the store methods each already has in scope, so a key press and the
 * matching panel row do exactly the same thing.
 */

export interface SessionNavDeps {
  getActiveSessionForProject(projectId: string): string | null | undefined
  setActiveSessionForProject(projectId: string, sessionId: string): void
}

function selectSessionEverywhere(
  session: { id: string; projectId: string },
  deps: SessionNavDeps
): void {
  clearTabsEverywhere()
  useWorkspaceStore.getState().setActiveProject(session.projectId)
  deps.setActiveSessionForProject(session.projectId, session.id)
  useSessionStore.getState().requestFocus(session.id)
}

export function cycleMostRecentlyAttended(
  effectiveProjectId: string | null,
  delta: number,
  deps: SessionNavDeps
): void {
  const all = [...useSessionStore.getState().sessions.values()]
    .filter((s) => s.status !== 'closed')
    .sort((a, b) => (b.lastAttendedAt ?? 0) - (a.lastAttendedAt ?? 0))
  if (all.length < 2) return
  const currentId = effectiveProjectId
    ? deps.getActiveSessionForProject(effectiveProjectId)
    : all[0].id
  const index = all.findIndex((s) => s.id === currentId)
  const next = all[((((index === -1 ? 0 : index) + delta) % all.length) + all.length) % all.length]
  selectSessionEverywhere(next, deps)
}

export function jumpToNextAwaitingInput(
  effectiveProjectId: string | null,
  deps: SessionNavDeps
): void {
  const waiting = [...useSessionStore.getState().sessions.values()].filter(
    (s) => s.agentState === 'awaiting-input'
  )
  if (waiting.length === 0) return
  const currentId = effectiveProjectId ? deps.getActiveSessionForProject(effectiveProjectId) : null
  const index = waiting.findIndex((s) => s.id === currentId)
  selectSessionEverywhere(waiting[(index + 1) % waiting.length], deps)
}

export interface WorkspaceCycleDeps {
  workspaces: { id: string }[]
  activeWorkspaceId: string | null
  setActiveWorkspace(id: string): void
  setExpandedWorkspaceIds(ids: Set<string>): void
}

export function cycleWorkspace(delta: number, deps: WorkspaceCycleDeps): void {
  const { workspaces, activeWorkspaceId, setActiveWorkspace, setExpandedWorkspaceIds } = deps
  if (workspaces.length === 0) return
  const idx = workspaces.findIndex((w) => w.id === activeWorkspaceId)
  const next = (idx + delta + workspaces.length) % workspaces.length
  setActiveWorkspace(workspaces[next].id)
  setExpandedWorkspaceIds(new Set([workspaces[next].id]))
}

export function switchToWorkspace(
  index: number,
  deps: Pick<WorkspaceCycleDeps, 'workspaces' | 'setActiveWorkspace' | 'setExpandedWorkspaceIds'>
): void {
  if (!deps.workspaces[index]) return
  deps.setActiveWorkspace(deps.workspaces[index].id)
  deps.setExpandedWorkspaceIds(new Set([deps.workspaces[index].id]))
}

export interface TabCycleDeps {
  getSessionsForProject(projectId: string): { id: string }[]
  getActiveSessionForProject(projectId: string): string | null | undefined
  setActiveSessionForProject(projectId: string, sessionId: string): void
}

export function cycleTab(projectId: string, delta: number, deps: TabCycleDeps): void {
  const { getSessionsForProject, getActiveSessionForProject, setActiveSessionForProject } = deps
  const sessions = getSessionsForProject(projectId)
  if (sessions.length === 0) return
  const activeId = getActiveSessionForProject(projectId)
  const idx = sessions.findIndex((s) => s.id === activeId)
  const next = sessions[(idx + delta + sessions.length) % sessions.length]
  clearTabsEverywhere()
  setActiveSessionForProject(projectId, next.id)
  useSessionStore.getState().requestFocus(next.id)
}

export function clearTerminal(
  effectiveProjectId: string | null,
  deps: Pick<TabCycleDeps, 'getActiveSessionForProject'>
): void {
  if (!effectiveProjectId) return
  const activeSessionId = deps.getActiveSessionForProject(effectiveProjectId)
  if (activeSessionId) window.electronAPI.terminal.input(activeSessionId, '\x0c')
}

export interface NewTabDeps {
  resolveSettings(workspaceId: string | null): { terminal: { scrollbackLimit: number } }
  resolveActiveCwd(): string
  activeWorkspaceId: string | null
  createSession(
    projectId: string,
    type: 'human',
    tabTitle: string,
    cwd: string,
    scrollbackLimit: number
  ): Promise<unknown>
}

export function newTerminalTab(effectiveProjectId: string | null, deps: NewTabDeps): void {
  if (!effectiveProjectId) return
  const settings = deps.resolveSettings(deps.activeWorkspaceId)
  const cwd = deps.resolveActiveCwd()
  void deps
    .createSession(effectiveProjectId, 'human', 'Terminal', cwd, settings.terminal.scrollbackLimit)
    .catch(() => {})
}

export interface SplitDeps {
  resolveSettings(workspaceId: string | null): { terminal: { scrollbackLimit: number } }
  resolveActiveCwd(): string
  activeWorkspaceId: string | null
  splitSession(
    projectId: string,
    direction: 'vertical' | 'horizontal',
    cwd: string,
    scrollbackLimit: number
  ): Promise<unknown>
}

export function splitPane(
  effectiveProjectId: string | null,
  direction: 'vertical' | 'horizontal',
  deps: SplitDeps
): void {
  if (!effectiveProjectId) return
  const settings = deps.resolveSettings(deps.activeWorkspaceId)
  const cwd = deps.resolveActiveCwd()
  deps
    .splitSession(effectiveProjectId, direction, cwd, settings.terminal.scrollbackLimit)
    .catch((error: unknown) =>
      dispatchNotification({
        type: 'error',
        title: 'Split pane failed',
        message: error instanceof Error ? error.message : 'Could not create split pane',
        key: 'splitPaneFailed',
      })
    )
}

export interface ClosePaneDeps {
  getPaneLayout(projectId: string): unknown
  getFocusedSession(projectId: string): string | null | undefined
  closeSplitLeaf(projectId: string, sessionId: string): void
  closeSession(sessionId: string): Promise<unknown>
  getActiveSessionForProject(projectId: string): string | null | undefined
}

export function closeFocusedPane(effectiveProjectId: string | null, deps: ClosePaneDeps): void {
  if (!effectiveProjectId) return
  const {
    getPaneLayout,
    getFocusedSession,
    closeSplitLeaf,
    closeSession,
    getActiveSessionForProject,
  } = deps
  const layout = getPaneLayout(effectiveProjectId)
  const focusedId = getFocusedSession(effectiveProjectId)
  if (layout && focusedId) {
    closeSplitLeaf(effectiveProjectId, focusedId)
    closeSession(focusedId).catch(() =>
      dispatchNotification({
        type: 'error',
        title: 'Close terminal failed',
        message: 'Could not close terminal',
        key: 'closeTerminalFailed',
      })
    )
  } else {
    const activeId = getActiveSessionForProject(effectiveProjectId)
    if (activeId) void closeSession(activeId)
  }
}
