import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspaceStore } from '../stores/workspace.store'
import { useSettingsStore } from '../stores/settings.store'
import { useIntegrationsStore } from '../stores/integrations.store'
import { useSessionStore } from '../stores/session.store'
import { useExtensionRegistry } from '../extensions/registry'
import { useTerminalSession } from '../hooks/useTerminalSession'
import { useSessionFacts, useIssue } from '../components/session/useSessionFacts'
import { revealSession } from '../terminal/navigate-to-session'
import { qualifiedBranchLabel } from '../sidebar/branch-display'
import { agentStateOf } from '../sidebar/agent-state'
import { buildCoreActions, type CoreSessionSummary } from './core-actions'
import type { QuickActionTarget } from './use-active-scope'
import type { CoreActionDeps } from './core-actions'
import type { PaneSplitDirection, TerminalSession, Workspace } from '../../shared/types/index'
import type { QuickAction } from './types'
import { cycleTab } from './shortcut-behaviors'

/** What the app shell does on behalf of an action: its own dialogs, panes and toggles. */
export interface ShellCommands {
  onNewTab(): void
  onNewScratch(): void
  onEditNote(sessionId: string | null): void
  onLinkSession(sessionId: string): void
  onToggleOverview(): void
  onToggleSidebar(): void
  onOpenSettings(): void
  onToggleLog(): void
}

/** Sessions are offered in the existing palette rather than a second overlay. */
function usePaletteSessions(): CoreSessionSummary[] {
  const sessions = useSessionStore(useShallow((s) => ({ sessions: s.sessions }))).sessions
  const { workspaces, projectsByWorkspaceId } = useWorkspaceStore(
    useShallow((s) => ({
      workspaces: s.workspaces,
      projectsByWorkspaceId: s.projectsByWorkspaceId,
    }))
  )
  return useMemo(() => {
    const repoNameById = new Map(workspaces.map((w) => [w.id, w.name]))
    const projectName = new Map(
      [...projectsByWorkspaceId.values()]
        .flat()
        .map((p) => [p.id, qualifiedBranchLabel(p, repoNameById.get(p.workspaceId))])
    )
    return [...sessions.values()]
      .filter((s) => s.status !== 'closed')
      .map((s) => ({
        id: s.id,
        projectId: s.projectId,
        tabTitle: s.tabTitle,
        projectName: projectName.get(s.projectId) ?? '',
      }))
  }, [sessions, projectsByWorkspaceId, workspaces])
}

/** Quick Actions' issue actions follow the focused terminal's own resolved ticket — its own
 * link, else its branch's — rather than always the branch's. */
function useFocusedIssue(focusedSessionId: string | null) {
  const sessionFacts = useSessionFacts()
  const focusedFacts = focusedSessionId
    ? sessionFacts.find((f) => f.sessionId === focusedSessionId)
    : undefined
  const focusedWorkItem = focusedFacts?.workItem ?? null
  const issue = useIssue(focusedWorkItem?.ref ?? null)
  return useMemo(
    () => ({
      issue: issue ?? null,
      issueLink: focusedWorkItem
        ? { key: focusedWorkItem.ref.key, tracker: focusedWorkItem.ref.tracker }
        : null,
    }),
    [focusedWorkItem, issue]
  )
}

/** What the core actions act on: the focus, the stores' current state and the shell. */
interface CoreContext {
  /** The project Quick Actions acts in; null when none is focused. */
  projectId: string | null
  focusedSessionId: string | null
  activeWorkspaceId: string | null
  activeProjectId: string | null
  workspaces: Workspace[]
  sessions: Map<string, TerminalSession>
  issueLink: CoreActionDeps['issueLink']
  issue: { url: string } | null
  shell: ShellCommands
  splitSession: ReturnType<typeof useTerminalSession>['splitSession']
}

type Handlers<Keys extends keyof CoreActionDeps> = Pick<CoreActionDeps, Keys>

function splitFocused(c: CoreContext, direction: PaneSplitDirection): void {
  if (!c.projectId) return
  const settings = useSettingsStore.getState().resolveSettings(c.activeWorkspaceId)
  const cwd = useWorkspaceStore.getState().resolveActiveCwd()
  void c.splitSession(c.projectId, direction, {
    cwd,
    scrollbackLimit: settings.terminal.scrollbackLimit,
  })
}

/** Closes the focused pane of a split, or else the tab on screen. */
function closePane(projectId: string | null): void {
  if (!projectId) return
  const store = useSessionStore.getState()
  const layout = store.getPaneLayout?.(projectId)
  const focusedId = store.getFocusedSession?.(projectId)
  if (layout && focusedId) {
    store.closeSplitLeaf(projectId, focusedId)
    void store.closeSession(focusedId)
  } else {
    const activeId = store.getActiveSessionForProject?.(projectId)
    if (activeId) void store.closeSession(activeId)
  }
}

function terminalHandlers(
  c: CoreContext
): Handlers<
  'onNewTab' | 'onSplit' | 'onClosePane' | 'onClear' | 'onNewScratch' | 'onEditNote' | 'onCycleTab'
> {
  return {
    onNewTab: c.shell.onNewTab,
    onSplit: (direction) => splitFocused(c, direction),
    onClosePane: () => closePane(c.projectId),
    onClear: () => {
      if (c.focusedSessionId) window.electronAPI.terminal.input(c.focusedSessionId, '\x0c')
    },
    onNewScratch: c.shell.onNewScratch,
    onEditNote: () => c.shell.onEditNote(c.focusedSessionId),
    // Within the project on screen, not the session's own: cycleTab leaves any other tab first.
    onCycleTab: (delta) => {
      if (c.projectId) cycleTab(c.projectId, delta, useSessionStore.getState())
    },
  }
}

/** Steps through the open sessions, most recently attended first. */
function cycleRecent(c: CoreContext, delta: number): void {
  const all = [...c.sessions.values()]
    .filter((s) => s.status !== 'closed')
    .sort((a, b) => (b.lastAttendedAt ?? 0) - (a.lastAttendedAt ?? 0))
  if (all.length < 2) return
  const idx = all.findIndex((s) => s.id === c.focusedSessionId)
  const next = all[((idx === -1 ? 0 : idx) + delta + all.length) % all.length]
  revealSession(next.id)
}

/** The waiting session after the focused one. */
function nextWaiting(c: CoreContext): void {
  const waiting = [...c.sessions.values()].filter((s) => agentStateOf(s) === 'awaiting-input')
  if (waiting.length === 0) return
  const idx = waiting.findIndex((s) => s.id === c.focusedSessionId)
  revealSession(waiting[(idx + 1) % waiting.length].id)
}

const showHome = (): void => useExtensionRegistry.getState().setActiveGlobalTab('core.home')

function sessionHandlers(
  c: CoreContext
): Handlers<'onCycleRecentSession' | 'onSelectSession' | 'onNextWaiting' | 'onResume' | 'onHome'> {
  return {
    onCycleRecentSession: (delta) => cycleRecent(c, delta),
    onSelectSession: (session) => revealSession(session.id),
    onNextWaiting: () => nextWaiting(c),
    onResume: showHome,
    onHome: showHome,
  }
}

function cycleActiveWorkspace(c: CoreContext, delta: number): void {
  if (c.workspaces.length === 0) return
  const idx = c.workspaces.findIndex((w) => w.id === c.activeWorkspaceId)
  const next = c.workspaces[(idx + delta + c.workspaces.length) % c.workspaces.length]
  useWorkspaceStore.getState().setActiveWorkspace(next.id)
}

function workspaceHandlers(
  c: CoreContext
): Handlers<'onSwitchWorkspace' | 'onCycleWorkspace' | 'onLinkIssueBranch' | 'onViewIssue'> {
  const integrations = useIntegrationsStore.getState()
  return {
    onSwitchWorkspace: (id) => useWorkspaceStore.getState().setActiveWorkspace(id),
    onCycleWorkspace: (delta) => cycleActiveWorkspace(c, delta),
    onLinkIssueBranch: () => c.activeProjectId && integrations.openLinkDialog(c.activeProjectId),
    onViewIssue: () => c.activeProjectId && integrations.openDrawer(c.activeProjectId),
  }
}

function issueHandlers(c: CoreContext): Handlers<'onLinkIssue' | 'onCopyIssueKey' | 'onOpenIssue'> {
  return {
    onLinkIssue: () => c.focusedSessionId && c.shell.onLinkSession(c.focusedSessionId),
    onCopyIssueKey: () => c.issueLink && void navigator.clipboard?.writeText(c.issueLink.key),
    onOpenIssue: () => c.issue && void window.electronAPI.shell.openExternal(c.issue.url),
  }
}

function shellHandlers(
  shell: ShellCommands
): Handlers<'onOverview' | 'onToggleSidebar' | 'onOpenSettings' | 'onToggleLog'> {
  return {
    onOverview: shell.onToggleOverview,
    onToggleSidebar: shell.onToggleSidebar,
    onOpenSettings: shell.onOpenSettings,
    onToggleLog: shell.onToggleLog,
  }
}

function coreActionDeps(c: CoreContext, paletteSessions: CoreSessionSummary[]): CoreActionDeps {
  return {
    hasProjectFocused: !!c.projectId,
    hasTerminalFocused: !!c.focusedSessionId,
    activeWorkspaceId: c.activeWorkspaceId,
    workspaces: c.workspaces.map((w) => ({ id: w.id, name: w.name })),
    sessions: paletteSessions,
    issueLink: c.issueLink,
    issue: c.issue,
    ...terminalHandlers(c),
    ...sessionHandlers(c),
    ...workspaceHandlers(c),
    ...issueHandlers(c),
    ...shellHandlers(c.shell),
  }
}

/** The focus, the stores' state and the shell the core actions read, as one value. */
function useCoreContext(target: QuickActionTarget, shell: ShellCommands): CoreContext {
  const { projectId, focusedSessionId } = target
  const workspaceFocus = useWorkspaceStore(
    useShallow((s) => ({
      activeWorkspaceId: s.activeWorkspaceId,
      activeProjectId: s.activeProjectId,
      workspaces: s.workspaces,
    }))
  )
  const sessions = useSessionStore((s) => s.sessions)
  const { splitSession } = useTerminalSession()
  const focusedIssue = useFocusedIssue(focusedSessionId)
  return useMemo(
    () => ({
      projectId,
      focusedSessionId,
      ...workspaceFocus,
      sessions,
      ...focusedIssue,
      shell,
      splitSession,
    }),
    [projectId, focusedSessionId, workspaceFocus, sessions, focusedIssue, shell, splitSession]
  )
}

export function useCoreQuickActions(
  target: QuickActionTarget,
  shell: ShellCommands
): QuickAction[] {
  const context = useCoreContext(target, shell)
  const paletteSessions = usePaletteSessions()
  return useMemo(
    () => buildCoreActions(coreActionDeps(context, paletteSessions)),
    [context, paletteSessions]
  )
}
