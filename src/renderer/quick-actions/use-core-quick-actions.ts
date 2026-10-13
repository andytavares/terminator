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
import type { QuickAction } from './types'

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

/**
 * Quick Actions' issue actions follow the focused terminal's own resolved
 * ticket — its own link, else its branch's — rather than always the branch's.
 */
function useFocusedIssue(focusedSessionId: string | null) {
  const sessionFacts = useSessionFacts()
  const focusedFacts = focusedSessionId
    ? sessionFacts.find((f) => f.sessionId === focusedSessionId)
    : undefined
  const focusedWorkItem = focusedFacts?.workItem ?? null
  const issue = useIssue(focusedWorkItem?.ref ?? null)
  const link = useMemo(
    () =>
      focusedWorkItem
        ? { key: focusedWorkItem.ref.key, tracker: focusedWorkItem.ref.tracker }
        : null,
    [focusedWorkItem]
  )
  return { issue: issue ?? null, link }
}

export function useCoreQuickActions(
  target: QuickActionTarget,
  shell: ShellCommands
): QuickAction[] {
  const { projectId: qaProjectId, focusedSessionId } = target
  const { activeWorkspaceId, activeProjectId, workspaces, setActiveWorkspace, resolveActiveCwd } =
    useWorkspaceStore(
      useShallow((s) => ({
        activeWorkspaceId: s.activeWorkspaceId,
        activeProjectId: s.activeProjectId,
        workspaces: s.workspaces,
        setActiveWorkspace: s.setActiveWorkspace,
        resolveActiveCwd: s.resolveActiveCwd,
      }))
    )
  const { resolveSettings } = useSettingsStore(
    useShallow((s) => ({ resolveSettings: s.resolveSettings }))
  )
  const { openLinkDialog, openDrawer } = useIntegrationsStore(
    useShallow((s) => ({ openLinkDialog: s.openLinkDialog, openDrawer: s.openDrawer }))
  )
  const {
    sessions,
    getSessionsForProject,
    getActiveSessionForProject,
    getFocusedSession,
    getPaneLayout,
    closeSplitLeaf,
    closeSession,
    setActiveSessionForProject,
  } = useSessionStore(
    useShallow((s) => ({
      sessions: s.sessions,
      getSessionsForProject: s.getSessionsForProject,
      getActiveSessionForProject: s.getActiveSessionForProject,
      getFocusedSession: s.getFocusedSession,
      getPaneLayout: s.getPaneLayout,
      closeSplitLeaf: s.closeSplitLeaf,
      closeSession: s.closeSession,
      setActiveSessionForProject: s.setActiveSessionForProject,
    }))
  )
  const { setActiveGlobalTab } = useExtensionRegistry(
    useShallow((s) => ({ setActiveGlobalTab: s.setActiveGlobalTab }))
  )
  const { splitSession } = useTerminalSession()
  const paletteSessions = usePaletteSessions()
  const { issue: focusedIssue, link: focusedIssueLink } = useFocusedIssue(focusedSessionId)

  return useMemo(
    () =>
      buildCoreActions({
        hasProjectFocused: !!qaProjectId,
        hasTerminalFocused: !!focusedSessionId,
        activeWorkspaceId,
        workspaces: workspaces.map((w) => ({ id: w.id, name: w.name })),
        sessions: paletteSessions,
        issueLink: focusedIssueLink,
        issue: focusedIssue,
        onNewTab: shell.onNewTab,
        onSplit: (direction) => {
          if (!qaProjectId) return
          const settings = resolveSettings(activeWorkspaceId)
          void splitSession(
            qaProjectId,
            direction,
            resolveActiveCwd(),
            settings.terminal.scrollbackLimit
          )
        },
        onClosePane: () => {
          if (!qaProjectId) return
          const layout = getPaneLayout?.(qaProjectId)
          const focusedId = getFocusedSession?.(qaProjectId)
          if (layout && focusedId) {
            closeSplitLeaf(qaProjectId, focusedId)
            void closeSession(focusedId)
          } else {
            const activeId = getActiveSessionForProject?.(qaProjectId)
            if (activeId) void closeSession(activeId)
          }
        },
        onClear: () => {
          if (focusedSessionId) window.electronAPI.terminal.input(focusedSessionId, '\x0c')
        },
        onNewScratch: shell.onNewScratch,
        onEditNote: () => shell.onEditNote(focusedSessionId),
        onCycleTab: (delta) => {
          if (!qaProjectId) return
          const list = getSessionsForProject(qaProjectId)
          if (list.length === 0) return
          const idx = list.findIndex((s) => s.id === getActiveSessionForProject?.(qaProjectId))
          const next = list[(((idx + delta) % list.length) + list.length) % list.length]
          // Cycling stays within the project already on screen — unlike the other
          // "go to session" paths it must not switch to the session's own
          // projectId — but still has to leave whatever tab is showing and ask
          // for focus, the way every other path does.
          useExtensionRegistry.getState().setActiveGlobalTab(null)
          useExtensionRegistry.getState().setActiveWorkspaceTab(null)
          useExtensionRegistry.getState().setActiveProjectTab(null)
          setActiveSessionForProject(qaProjectId, next.id)
          useSessionStore.getState().requestFocus(next.id)
        },
        onCycleRecentSession: (delta) => {
          const all = [...sessions.values()]
            .filter((s) => s.status !== 'closed')
            .sort((a, b) => (b.lastAttendedAt ?? 0) - (a.lastAttendedAt ?? 0))
          if (all.length < 2) return
          const idx = all.findIndex((s) => s.id === focusedSessionId)
          const next = all[((idx === -1 ? 0 : idx) + delta + all.length) % all.length]
          revealSession(next.id)
        },
        onSelectSession: (session) => {
          revealSession(session.id)
        },
        onNextWaiting: () => {
          const waiting = [...sessions.values()].filter((s) => agentStateOf(s) === 'awaiting-input')
          if (waiting.length === 0) return
          const idx = waiting.findIndex((s) => s.id === focusedSessionId)
          const next = waiting[(idx + 1) % waiting.length]
          revealSession(next.id)
        },
        onResume: () => setActiveGlobalTab('core.home'),
        onSwitchWorkspace: (id) => setActiveWorkspace(id),
        onCycleWorkspace: (delta) => {
          if (workspaces.length === 0) return
          const idx = workspaces.findIndex((w) => w.id === activeWorkspaceId)
          const next = workspaces[(idx + delta + workspaces.length) % workspaces.length]
          setActiveWorkspace(next.id)
        },
        onLinkIssue: () => focusedSessionId && shell.onLinkSession(focusedSessionId),
        onLinkIssueBranch: () => activeProjectId && openLinkDialog(activeProjectId),
        onViewIssue: () => activeProjectId && openDrawer(activeProjectId),
        onCopyIssueKey: () =>
          focusedIssueLink && void navigator.clipboard?.writeText(focusedIssueLink.key),
        onOpenIssue: () =>
          focusedIssue && void window.electronAPI.shell.openExternal(focusedIssue.url),
        onHome: () => setActiveGlobalTab('core.home'),
        onOverview: shell.onToggleOverview,
        onToggleSidebar: shell.onToggleSidebar,
        onOpenSettings: shell.onOpenSettings,
        onToggleLog: shell.onToggleLog,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      qaProjectId,
      focusedSessionId,
      activeWorkspaceId,
      workspaces,
      paletteSessions,
      focusedIssueLink,
      focusedIssue,
      sessions,
      activeProjectId,
      shell,
    ]
  )
}
