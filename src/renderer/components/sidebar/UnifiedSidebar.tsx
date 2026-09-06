import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GlobalTabRegistration } from '../../extensions/registry'
import type { SessionView } from '../../sidebar/view-model'
import type { Workspace } from '../../../shared/types/index'
import { useExtensionRegistry } from '../../extensions/registry'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSessionStore } from '../../stores/session.store'
import { useSettingsStore } from '../../stores/settings.store'
import { useToastStore } from '../../stores/toast.store'
import { useTerminalSession } from '../../hooks/useTerminalSession'
import { buildBranchRows, type BranchRow as BranchRowData } from '../../sidebar/branch-rows'
import { BellAndBusySource } from '../../sidebar/agent-state'
import { abbreviatePath, branchLabel, qualifiedBranchLabel } from '../../sidebar/branch-display'
import { useChangeStatsStore } from '../../stores/change-stats.store'
import { BUILT_IN_VIEWS, DEFAULT_VIEW_ID, loadViews, saveViews } from '../../sidebar/views'
import {
  isCollapsed as isGroupCollapsed,
  loadCollapseState,
  saveCollapseState,
  toggleCollapsed,
  TERMINALS_NAMESPACE,
} from '../../sidebar/collapse-state'
import { useDragReorder, type DragItemProps } from '../../hooks/useDragReorder'
import { mergeReorder } from '../../sidebar/manual-order'
import { TerminalRow } from './TerminalRow'
import { ConfirmDialog } from '../ConfirmDialog'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import { EditWorkspaceDialog } from './EditWorkspaceDialog'
import { CreateProjectDialog } from './CreateProjectDialog'
import { SidebarHeader } from './SidebarHeader'
import { LinkIssueDialog } from '../integrations/LinkIssueDialog'
import { IssueDrawer } from '../integrations/IssueDrawer'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { FilterMenu } from './FilterMenu'
import { DisplayMenu } from './DisplayMenu'
import { RepoHeader } from './RepoHeader'
import { BranchRow } from './BranchRow'
import './UnifiedSidebar.css'

interface UnifiedSidebarProps {
  /** Session whose note the host asked to edit (Cmd+I). */
  globalTabs: GlobalTabRegistration[]
  activeGlobalTabId: string | null
  onSelectGlobalTab: (id: string) => void
  activeWorkspaceTabId: string | null
  onSelectWorkspaceTab: (workspaceId: string, tabId: string) => void
  onSelectProject?: () => void
  unreadNotifications: number
  onBellClick: () => void
  onNewScratch: () => void
  activeScratchSessionId: string | null
  onSelectScratchSession: (sessionId: string) => void
  visible: boolean
  /** Injected by tests so relative times and staleness are deterministic. */
  now?: number
  /** Initial saved view. Phase 5's view bar drives this through state. */
  initialViewId?: string
}

const SIDEBAR_WIDTH_KEY = 'terminator.sidebar.width'
// The branch row carries name, state, worktree marker and change statistics.
// 260px truncated a 30-character branch name to uselessness, which is the
// ambiguity this feature exists to remove (research R3).
const DEFAULT_WIDTH = 300
const MIN_WIDTH = 200
const MAX_WIDTH = 480
/** What each failure means, said in the user's terms rather than the code's. */
const EDITOR_ERRORS: Record<string, string> = {
  FOLDER_NOT_FOUND: 'That folder is no longer on disk.',
  NO_EDITOR_FOUND: 'No supported editor found. Install one, or set ui.editor in settings.',
  VALIDATION_ERROR: 'That folder could not be opened.',
}

const DEFAULT_STALE_AFTER_MS = 2 * 60 * 60 * 1000

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (raw) {
      const n = parseInt(raw, 10)
      if (!isNaN(n)) return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n))
    }
  } catch {
    // ignore
  }
  return DEFAULT_WIDTH
}

export function UnifiedSidebar({
  globalTabs,
  activeGlobalTabId,
  onSelectGlobalTab,
  activeWorkspaceTabId,
  onSelectWorkspaceTab,
  onSelectProject,
  unreadNotifications,
  onBellClick,
  onNewScratch,
  activeScratchSessionId,
  onSelectScratchSession,
  visible,
  now,
  initialViewId = DEFAULT_VIEW_ID,
}: UnifiedSidebarProps): JSX.Element {
  const {
    workspaces,
    activeProjectId,
    activeWorkspaceId,
    projectsByWorkspaceId,
    setActiveProject,
    setActiveWorkspace,
    loadProjects,
    reorderWorkspaces,
    reorderProjects,
    deleteProject,
    deleteWorkspace,
    renameProject,
    resolveActiveCwd,
  } = useWorkspaceStore()
  const sessionStore = useSessionStore()
  const { sessions, projectViews } = sessionStore
  const { resolveSettings } = useSettingsStore()
  const {
    statsFor,
    ensure: ensureChangeStats,
    invalidate: invalidateStats,
    invalidateAll: invalidateAllStats,
  } = useChangeStatsStore()
  /** Last activity seen per branch, so work in a terminal refreshes its statistics. */
  const lastActivityByBranch = useRef(new Map<string, number>())
  const staleAfterMs = resolveSettings().sidebar?.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
  const { createSession } = useTerminalSession()
  const workspaceTabs = useExtensionRegistry((s) => s.workspaceTabs)
  const sidebarButtons = useExtensionRegistry((s) => s.sidebarButtons)

  // Eager-load projects for every workspace that has not been fetched yet.
  // The flat list shows all workspaces at once, so we cannot rely on
  // setActiveWorkspace to trigger loadProjects one at a time.
  useEffect(() => {
    for (const ws of workspaces) {
      if (!projectsByWorkspaceId.has(ws.id)) {
        void loadProjects(ws.id)
      }
    }
  }, [workspaces, projectsByWorkspaceId, loadProjects])

  const [width, setWidth] = useState(readStoredWidth)
  const [createWsOpen, setCreateWsOpen] = useState(false)
  const [createProjectFor, setCreateProjectFor] = useState<string | null>(null)
  const [editWorkspace, setEditWorkspace] = useState<Workspace | null>(null)
  const [confirmDeleteWorkspace, setConfirmDeleteWorkspace] = useState<Workspace | null>(null)
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<{
    id: string
    name: string
  } | null>(null)
  const {
    linkFor: issueLinkFor,
    issueFor,
    loadLink,
    unlinkIssue,
    subscribe: subscribeIntegrations,
    loadConnections: loadTrackerConnections,
    linkDialogProjectId,
    openLinkDialog,
    closeLinkDialog,
    drawerProjectId,
    openDrawer,
    closeDrawer,
  } = useIntegrationsStore()

  /** Home directory, so a repo's path reads as `~/repos/app` rather than in full. */
  const [homeDir, setHomeDir] = useState<string | undefined>(undefined)
  /** The editor this machine will use, so the menu can name it. */
  const [editorName, setEditorName] = useState<string | undefined>(undefined)
  const [searchQuery, setSearchQuery] = useState('')
  const [collapseState, setCollapseState] = useState(loadCollapseState)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(width)
  const dragStartXRef = useRef<number | null>(null)

  // The repo drag lives further down, next to the drawn order it reorders.

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragStartXRef.current = e.clientX

    function onMouseMove(ev: MouseEvent): void {
      if (dragStartXRef.current === null) return
      const dx = ev.clientX - dragStartXRef.current
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, widthRef.current + dx))
      if (sidebarRef.current) sidebarRef.current.style.width = `${next}px`
    }

    function onMouseUp(ev: MouseEvent): void {
      if (dragStartXRef.current === null) return
      const dx = ev.clientX - dragStartXRef.current
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, widthRef.current + dx))
      widthRef.current = next
      setWidth(next)
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next))
      } catch {
        // ignore
      }
      dragStartXRef.current = null
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  function handleResizeDblClick(): void {
    widthRef.current = DEFAULT_WIDTH
    setWidth(DEFAULT_WIDTH)
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(DEFAULT_WIDTH))
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    widthRef.current = width
  }, [width])

  useEffect(() => {
    void window.electronAPI?.app
      ?.getInfo?.()
      .then((info) => setHomeDir(info.homeDir))
      .catch(() => setHomeDir(undefined))
  }, [])

  useEffect(() => {
    void window.electronAPI?.editor
      ?.detect?.()
      .then((r) => setEditorName(r.editor?.name))
      .catch(() => setEditorName(undefined))
  }, [])

  /**
   * The folder a branch's work happens in: its own working copy when it has
   * one, else the repo it was checked out from. Same resolution the terminal
   * and the change statistics use.
   */
  function folderForBranch(projectId: string): string | undefined {
    const project = projectById.get(projectId)
    if (project === undefined) return undefined
    return project.worktreePath ?? workspaceById.get(project.workspaceId)?.folderPath
  }

  /**
   * Opening reports back. The first version discarded the result, so a folder
   * that had moved, or a machine with no editor, produced exactly nothing on
   * screen — indistinguishable from the action not being wired up at all.
   */
  function openInEditor(folderPath: string | undefined): void {
    const say = (message: string): void =>
      useToastStore.getState().addToast({ type: 'error', message })

    if (folderPath === undefined) {
      say('That branch has no folder on disk yet.')
      return
    }
    // `?.then`, not `.then`: optional chaining stops at the call, so when the
    // editor API is absent — the browser remote omits it entirely — `open?.()`
    // yields undefined and a bare `.then` throws.
    void window.electronAPI?.editor
      ?.open?.(folderPath)
      ?.then((result) => {
        if ('error' in result) say(EDITOR_ERRORS[result.error] ?? `Could not open: ${result.error}`)
      })
      ?.catch(() => say('Could not open that folder in your editor.'))
  }

  // Coming back to the window is the cheapest moment to notice that the working
  // trees moved on while you were away.
  useEffect(() => {
    window.addEventListener('focus', invalidateAllStats)
    return () => window.removeEventListener('focus', invalidateAllStats)
  }, [invalidateAllStats])

  // The active view is deliberately component state, never restored from
  // storage: a filtered view must never be what greets you at launch (FR-015).
  const [views, setViews] = useState(loadViews)
  const [activeViewId, setActiveViewId] = useState(initialViewId)
  const view = useMemo(() => {
    const base =
      views.find((v) => v.id === activeViewId) ??
      BUILT_IN_VIEWS.find((v) => v.id === DEFAULT_VIEW_ID)!
    return searchQuery ? { ...base, filters: { ...base.filters, query: searchQuery } } : base
  }, [views, activeViewId, searchQuery])

  function persist(next: SessionView[]): void {
    setViews(next)
    saveViews(next)
  }

  function changeActiveView(patch: Partial<SessionView>): void {
    persist(views.map((v) => (v.id === activeViewId ? { ...v, ...patch } : v)))
  }

  function showAll(): void {
    setSearchQuery('')
    setActiveViewId(DEFAULT_VIEW_ID)
  }

  const allProjects = useMemo(
    () => workspaces.flatMap((ws) => projectsByWorkspaceId.get(ws.id) ?? []),
    [workspaces, projectsByWorkspaceId]
  )

  // agentState is view state derived from bell, byte flow and exit — the type
  // says so, but nothing was deriving it, so every session read as 'idle'
  // forever and the Needs me / Active / Stale views filtered on a constant.
  // Deriving here keeps it a pure function of the store rather than a fourth
  // thing to hold in sync, and keeps buildGroups pure.
  const sessionList = useMemo(() => {
    const source = new BellAndBusySource()
    // Derive before filtering: the keep-if-exited rule reads agentState, and
    // reading it before deriving would drop every closed session.
    return [...sessions.values()]
      .map((s) => {
        const agentState = source.derive(s)
        return agentState === s.agentState ? s : { ...s, agentState }
      })
      .filter((s) => s.status !== 'closed' || s.agentState === 'exited')
  }, [sessions])

  // Work in a terminal changes the tree under it, so a branch whose sessions
  // just did something gets its statistics dropped rather than waiting out the
  // TTL. Tracked here rather than in the session store: making the session
  // store import the stats store would couple two things that have no other
  // reason to know about each other.
  useEffect(() => {
    const seen = lastActivityByBranch.current
    for (const session of sessionList) {
      const previous = seen.get(session.projectId) ?? 0
      if (session.lastActivityAt > previous) {
        seen.set(session.projectId, session.lastActivityAt)
        if (previous !== 0) invalidateStats(session.projectId)
      }
    }
  }, [sessionList, invalidateStats])

  const clock = now ?? Date.now()
  const { groups, scratch, shown, total } = useMemo(
    () => buildBranchRows(sessionList, allProjects, workspaces, view, clock, staleAfterMs),
    [sessionList, allProjects, workspaces, view, clock, staleAfterMs]
  )

  // What each view would show, so a chip can say "Needs me · 6" without the
  // user having to switch to it and look.
  const viewCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const v of views) {
      out[v.id] = buildBranchRows(
        sessionList,
        allProjects,
        workspaces,
        v,
        clock,
        staleAfterMs
      ).shown
    }
    return out
  }, [views, sessionList, allProjects, workspaces, clock, staleAfterMs])

  const projectById = useMemo(() => new Map(allProjects.map((p) => [p.id, p])), [allProjects])
  const workspaceById = useMemo(() => new Map(workspaces.map((w) => [w.id, w])), [workspaces])

  // ── Dragging is how the manual order is written ───────────────────────────
  //
  // A drag reorders the list as drawn, which is not the list as stored the
  // moment a computed sort or a filter is on. So the hook is given the drawn
  // repos, and `mergeReorder` folds the result back into the stored list.
  //
  // Committing it also switches the view to Manual: any other sort would
  // recompute the order on the next render and the drag would vanish, which is
  // exactly what it did.
  const orderedWorkspaces = useMemo(
    () => groups.flatMap((g) => workspaceById.get(g.workspaceId) ?? []),
    [groups, workspaceById]
  )
  const { dragOverIndex, getItemProps } = useDragReorder(orderedWorkspaces, (reordered) => {
    void reorderWorkspaces(mergeReorder(workspaces, reordered, (w) => w.id).map((w) => w.id))
    changeActiveView({ sortBy: 'manual' })
  })

  function reorderBranches(workspaceId: string, rows: BranchRowData[]): void {
    const stored = projectsByWorkspaceId.get(workspaceId) ?? []
    const dragged = rows.flatMap((row) => projectById.get(row.projectId) ?? [])
    void reorderProjects(
      workspaceId,
      mergeReorder(stored, dragged, (p) => p.id).map((p) => p.id)
    )
    changeActiveView({ sortBy: 'manual' })
  }

  // FR-027 lists three ways to reach a scope action: the group header, the row
  // scope menu, and the command palette. This is the third.
  const registerCommand = useExtensionRegistry((s) => s.registerCommand)
  useEffect(() => {
    const disposers = allProjects.map((project) =>
      registerCommand({
        id: `core.scope.new-terminal.${project.id}`,
        // Qualified by repo: every repo's default branch is called main, so an
        // unqualified label lists the same words once per repo.
        label: `New terminal — ${qualifiedBranchLabel(
          project,
          workspaceById.get(project.workspaceId)?.name
        )}`,
        category: 'Sessions',
        action: () => {
          const settings = resolveSettings(project.workspaceId)
          void createSession(
            project.id,
            'human',
            '',
            resolveActiveCwd(),
            settings.terminal.scrollbackLimit
          ).catch(() => {})
        },
      })
    )
    return () => disposers.forEach((dispose) => dispose())
  }, [allProjects, registerCommand, createSession, resolveActiveCwd, resolveSettings])

  function toggleGroup(key: string): void {
    const next = toggleCollapsed(collapseState, view.groupBy, key)
    setCollapseState(next)
    saveCollapseState(next)
  }

  /**
   * Whether a branch's terminals are listed.
   *
   * The polarity is *collapsed*, like every other group here — but a branch's
   * terminals start hidden, because the sidebar's job is still to stop at the
   * branch by default (ADR-035) and expanding is how you go further.
   */
  function terminalsExpanded(projectId: string): boolean {
    return isGroupCollapsed(collapseState, TERMINALS_NAMESPACE, projectId)
  }

  function toggleTerminals(projectId: string): void {
    const next = toggleCollapsed(collapseState, TERMINALS_NAMESPACE, projectId)
    setCollapseState(next)
    saveCollapseState(next)
  }

  /** Which terminal a project is currently showing. */
  function activeSessionIdFor(projectId: string): string | null {
    return projectViews.get(projectId)?.activeSessionId ?? null
  }

  /** Leaves the split layout first, then ends the session — as Cmd+W does. */
  function closeTerminal(projectId: string, sessionId: string): void {
    sessionStore.closeSplitLeaf(projectId, sessionId)
    void sessionStore.closeSession(sessionId)
  }

  /**
   * Selecting a session sets activeProjectId as well as the project's active
   * session. Leaving activeProjectId undefined under a non-project grouping
   * would break per-project auto-open and the project tab bar (invariant I4).
   */
  function selectSession(projectId: string, sessionId: string): void {
    const project = projectById.get(projectId)
    if (project) setActiveWorkspace(project.workspaceId)
    setActiveProject(projectId)
    sessionStore.setActiveSessionForProject(projectId, sessionId)
    onSelectProject?.()
  }

  /**
   * Selecting a project is what the tree's project row did on click, and what
   * the per-project auto-open effect keys off: a project with no sessions gets
   * its first terminal from this.
   */
  function selectProjectScope(projectId: string): void {
    const project = projectById.get(projectId)
    if (!project) return
    setActiveWorkspace(project.workspaceId)
    setActiveProject(projectId)
    onSelectProject?.()
  }

  function addSessionToProject(projectId: string): void {
    const project = projectById.get(projectId)
    if (!project) return
    // Starting a terminal in a project selects it, the way clicking the tree's
    // project row used to. Without this the session appears in the sidebar
    // while the main area still shows whatever was there before.
    setActiveWorkspace(project.workspaceId)
    setActiveProject(projectId)
    onSelectProject?.()
    const settings = resolveSettings(project.workspaceId)
    void createSession(
      projectId,
      'human',
      '',
      resolveActiveCwd(),
      settings.terminal.scrollbackLimit
    ).catch(() => {})
  }

  const workspaceTabList = Array.from(workspaceTabs.values())

  // ── Attached issues ───────────────────────────────────────────────────────
  //
  // The sidebar's view model knows nothing about issue trackers; it deals in
  // projects. The badge is looked up here, by project id, and passed down as a
  // node.

  useEffect(() => {
    void loadTrackerConnections()
    return subscribeIntegrations()
  }, [loadTrackerConnections, subscribeIntegrations])

  useEffect(() => {
    for (const project of allProjects) void loadLink(project.id)
  }, [allProjects, loadLink])

  /** One definition, handed to the branch row's menu. */
  function issueActionsFor(projectId: string) {
    return {
      issueKey: issueLinkFor(projectId)?.key ?? null,
      onLinkIssue: () => openLinkDialog(projectId),
      onOpenIssue: () => openLinkedIssue(projectId),
      onCopyIssueKey: () => copyIssueKey(projectId),
      onUnlinkIssue: () => void unlinkIssue(projectId),
    }
  }

  function openLinkedIssue(projectId: string): void {
    const issue = issueFor(projectId)
    if (issue === null) return
    void window.electronAPI.shell.openExternal(issue.url)
  }

  function copyIssueKey(projectId: string): void {
    const link = issueLinkFor(projectId)
    if (link === null) return
    void navigator.clipboard?.writeText(link.key)
  }

  /**
   * One group, and — under workspace grouping — the project groups nested
   * inside it. A project group is the same component at either level, so a
   * project keeps its header actions (select, +, branch switcher, issue, rename,
   * remove) whichever grouping the user is in.
   */
  /**
   * Which terminal a branch opens on (FR-047).
   *
   * One that is waiting on you first — it is the only state blocked on you and
   * the reason you clicked. Then the one you last had open on this branch,
   * which the store has kept all along. Then the most recently active. A branch
   * with none is left to the caller to offer starting one.
   */
  function terminalToFocus(projectId: string): string | undefined {
    const own = sessionList.filter((s) => s.projectId === projectId)
    if (own.length === 0) return undefined
    const waiting = own.find((s) => s.agentState === 'awaiting-input')
    if (waiting) return waiting.id
    const last = projectViews.get(projectId)?.activeSessionId
    if (last !== undefined && own.some((s) => s.id === last)) return last
    return [...own].sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0].id
  }

  function selectBranch(projectId: string): void {
    const focus = terminalToFocus(projectId)
    if (focus === undefined) {
      // Nothing running on it. Selecting the branch is enough: App's auto-open
      // effect gives a branch with no terminals its first one, so starting one
      // here as well would open two.
      selectProjectScope(projectId)
      return
    }
    selectProjectScope(projectId)
    selectSession(projectId, focus)
  }

  function renderBranch(
    row: BranchRowData,
    workspace: Workspace | undefined,
    dragProps?: DragItemProps,
    dragOver?: boolean
  ): JSX.Element {
    const project = projectById.get(row.projectId)

    // Asking for a branch's change volume the first time its row renders, and
    // never awaiting the answer.
    const branchCwd = project ? (project.worktreePath ?? workspace?.folderPath) : undefined
    if (project && branchCwd) ensureChangeStats(row.projectId, branchCwd, clock)

    const expanded = terminalsExpanded(row.projectId)

    return (
      <React.Fragment key={row.projectId}>
        <BranchRow
          row={row}
          dragProps={dragProps}
          dragOver={dragOver}
          expanded={expanded}
          onToggleExpanded={() => toggleTerminals(row.projectId)}
          selected={row.projectId === activeProjectId}
          colour={workspace?.color}
          now={clock}
          issueKey={issueLinkFor(row.projectId)?.key ?? null}
          onIssueClick={() => openDrawer(row.projectId)}
          changeStats={statsFor(row.projectId)?.stats}
          onSelect={() => selectBranch(row.projectId)}
          onAddTerminal={() => addSessionToProject(row.projectId)}
          // A branch is named by its branch (ADR-034), so there is nothing to
          // rename. A branch in a folder that is not a repo has no branch, and
          // its stored name is the only name it has.
          onRename={
            project && project.gitBranch === undefined
              ? (name) => void renameProject(row.projectId, name)
              : undefined
          }
          onRemove={() => setConfirmDeleteProject({ id: row.projectId, name: row.label })}
          onOpenInEditor={() => openInEditor(folderForBranch(row.projectId))}
          editorName={editorName}
          issueActions={issueActionsFor(row.projectId)}
          repoActions={workspaceTabList.map((tab) => ({
            id: tab.id,
            label: tab.label,
            onSelect: () => onSelectWorkspaceTab(row.workspaceId, tab.id),
          }))}
        />

        {/* The terminals under this branch, and the panes under each of them.
            Rendered here rather than inside BranchRow so a row stays one row —
            the same shape the repo header and its branches already use. */}
        {expanded &&
          row.terminals.map((terminal) => (
            <React.Fragment key={terminal.sessionId}>
              <TerminalRow
                terminal={terminal}
                selected={activeSessionIdFor(row.projectId) === terminal.sessionId}
                onSelect={() => selectSession(row.projectId, terminal.sessionId)}
                onClose={() => closeTerminal(row.projectId, terminal.sessionId)}
              />
              {terminal.panes.map((pane) => (
                <TerminalRow
                  key={pane.sessionId}
                  terminal={pane}
                  nested
                  selected={activeSessionIdFor(row.projectId) === pane.sessionId}
                  onSelect={() => selectSession(row.projectId, pane.sessionId)}
                  onClose={() => closeTerminal(row.projectId, pane.sessionId)}
                />
              ))}
            </React.Fragment>
          ))}
      </React.Fragment>
    )
  }

  return (
    <>
      <div
        ref={sidebarRef}
        className={`unified-sidebar${visible ? '' : ' unified-sidebar--hidden'}`}
        style={{ width }}
      >
        <SidebarHeader
          globalTabs={globalTabs}
          sidebarItems={sidebarButtons}
          activeGlobalTabId={activeGlobalTabId}
          onSelectGlobalTab={onSelectGlobalTab}
          onSearchFocus={() => {}}
          onAddWorkspace={() => setCreateWsOpen(true)}
          unreadNotifications={unreadNotifications}
          onBellClick={onBellClick}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSearchClear={() => setSearchQuery('')}
        >
          <FilterMenu
            views={views}
            activeViewId={activeViewId}
            counts={viewCounts}
            onSelectView={setActiveViewId}
            onChangeView={changeActiveView}
            hideStaleUnavailable={view.filters.staleOnly === true}
            shown={shown}
            total={total}
            onShowAll={showAll}
          />
          <DisplayMenu view={view} onChangeView={changeActiveView} />
        </SidebarHeader>

        <div className="unified-sidebar__list">
          {groups.map((group) => {
            const workspace = workspaceById.get(group.workspaceId)
            const collapsed = isGroupCollapsed(collapseState, view.groupBy, group.workspaceId)
            const ownsTabs = workspace !== undefined
            const dragIndex = orderedWorkspaces.findIndex((w) => w.id === group.workspaceId)
            return (
              <React.Fragment key={group.workspaceId}>
                <RepoHeader
                  group={group}
                  pathLabel={abbreviatePath(group.folderPath, homeDir)}
                  dragProps={dragIndex === -1 ? undefined : getItemProps(dragIndex)}
                  dragOver={dragIndex !== -1 && dragOverIndex === dragIndex}
                  collapsed={collapsed}
                  onToggleCollapse={() => toggleGroup(group.workspaceId)}
                  onAddBranch={workspace ? () => setCreateProjectFor(workspace.id) : undefined}
                  onEdit={workspace ? () => setEditWorkspace(workspace) : undefined}
                  onRemove={workspace ? () => setConfirmDeleteWorkspace(workspace) : undefined}
                  onOpenInEditor={workspace ? () => openInEditor(workspace.folderPath) : undefined}
                  editorName={editorName}
                  workspaceTabs={ownsTabs ? workspaceTabList : undefined}
                  activeWorkspaceTabId={
                    activeWorkspaceId === group.workspaceId ? activeWorkspaceTabId : null
                  }
                  onSelectWorkspaceTab={
                    workspace ? (tabId) => onSelectWorkspaceTab(workspace.id, tabId) : undefined
                  }
                />
                {!collapsed && (
                  <BranchList
                    rows={group.branches}
                    // Under "no grouping" one list holds every repo's branches
                    // and the stores have nowhere to write an order that
                    // crosses repos, so there is nothing to drag there.
                    onReorder={
                      workspace ? (rows) => reorderBranches(workspace.id, rows) : undefined
                    }
                    renderRow={(row, dragProps, dragOver) =>
                      renderBranch(row, workspace, dragProps, dragOver)
                    }
                  />
                )}
              </React.Fragment>
            )
          })}

          {/* Scratch terminals belong to no branch, so they are the one place a
              terminal is still a row. Drawn as branch rows because in this
              section a scratch terminal IS the unit of work — same anatomy,
              same vocabulary, and no colour rail because it has no repo. */}
          {(scratch.length > 0 || groups.length > 0) && (
            <div className="unified-sidebar__scratch">
              <div className="unified-sidebar__scratch-head">
                <span className="unified-sidebar__scratch-label">Scratch</span>
                <button
                  className="unified-sidebar__scratch-add"
                  title="New scratch terminal"
                  aria-label="New scratch terminal"
                  onClick={onNewScratch}
                >
                  +
                </button>
                {/* Last on the row, in the same column as every other count. */}
                <span className="unified-sidebar__scratch-count">{scratch.length}</span>
              </div>
              {scratch.map((session) => (
                <BranchRow
                  key={session.id}
                  row={{
                    projectId: session.id,
                    label: session.tabTitle,
                    // No kind marker: a scratch folder is neither a worktree nor
                    // a checkout, and the glyph would be answering a question
                    // nobody asked of it.
                    isWorktree: true,
                    state: session.agentState,
                    stateCount: 1,
                    sessionCount: 1,
                    // A scratch row *is* its terminal, so what nests under it
                    // is the panes split off it — the same one level the
                    // session controller pins.
                    terminals: [...sessions.values()]
                      .filter((s) => s.parentSessionId === session.id)
                      .map((pane) => ({
                        sessionId: pane.id,
                        title: pane.tabTitle,
                        state: pane.agentState,
                        bellCount: pane.bellCount ?? 0,
                        panes: [],
                      })),
                    lastActivityAt: session.lastActivityAt,
                    workspaceId: '',
                  }}
                  selected={activeScratchSessionId === session.id}
                  now={clock}
                  onSelect={() => onSelectScratchSession(session.id)}
                  onRename={(title) => sessionStore.renameSession(session.id, title)}
                />
              ))}
            </div>
          )}

          {groups.length === 0 && (
            <div className="unified-sidebar__empty">
              {searchQuery ? `No branches match "${searchQuery}"` : 'No branches yet'}
            </div>
          )}
        </div>

        <div
          className="unified-sidebar__resize-handle"
          onMouseDown={handleResizeMouseDown}
          onDoubleClick={handleResizeDblClick}
        />
      </div>

      {linkDialogProjectId !== null &&
        (() => {
          const project = projectById.get(linkDialogProjectId)
          if (!project) return null
          return (
            <LinkIssueDialog
              projectId={project.id}
              // Qualified: "Attaching to main" named one of six identical things.
              projectName={qualifiedBranchLabel(
                project,
                workspaceById.get(project.workspaceId)?.name
              )}
              currentKey={issueLinkFor(project.id)?.key ?? null}
              onClose={closeLinkDialog}
            />
          )
        })()}

      {drawerProjectId !== null &&
        (() => {
          const project = projectById.get(drawerProjectId)
          if (!project) return null
          return (
            <div className="issue-drawer-host">
              <IssueDrawer
                projectId={project.id}
                projectName={branchLabel(project)}
                onClose={closeDrawer}
              />
            </div>
          )
        })()}

      {createWsOpen && <CreateWorkspaceDialog onClose={() => setCreateWsOpen(false)} />}
      {editWorkspace && (
        <EditWorkspaceDialog workspace={editWorkspace} onClose={() => setEditWorkspace(null)} />
      )}
      {confirmDeleteWorkspace && (
        <ConfirmDialog
          title={`Remove workspace "${confirmDeleteWorkspace.name}"?`}
          confirmLabel="Remove"
          danger
          onConfirm={() => {
            void deleteWorkspace(confirmDeleteWorkspace.id)
            setConfirmDeleteWorkspace(null)
          }}
          onClose={() => setConfirmDeleteWorkspace(null)}
        />
      )}
      {createProjectFor && (
        <CreateProjectDialog
          workspaceId={createProjectFor}
          onClose={() => setCreateProjectFor(null)}
        />
      )}
      {confirmDeleteProject && (
        <ConfirmDialog
          title={`Remove branch "${confirmDeleteProject.name}"?`}
          confirmLabel="Remove"
          danger
          onConfirm={() => {
            void deleteProject(confirmDeleteProject.id)
            setConfirmDeleteProject(null)
          }}
          onClose={() => setConfirmDeleteProject(null)}
        />
      )}
    </>
  )
}

/**
 * One repo's branches, drag-reorderable.
 *
 * A component rather than a loop in the parent because each repo needs its own
 * drag state and a hook cannot be called per iteration. It renders nothing of
 * its own: the row is still the parent's to draw, so nothing had to be threaded
 * through here to get it.
 */
function BranchList({
  rows,
  onReorder,
  renderRow,
}: {
  rows: BranchRowData[]
  /** Absent where a manual order has nowhere to be written. */
  onReorder?: (rows: BranchRowData[]) => void
  renderRow: (row: BranchRowData, dragProps?: DragItemProps, dragOver?: boolean) => JSX.Element
}): JSX.Element {
  const { dragOverIndex, getItemProps } = useDragReorder(rows, (reordered) =>
    onReorder?.(reordered)
  )
  return (
    <>
      {rows.map((row, i) =>
        renderRow(row, onReorder ? getItemProps(i) : undefined, dragOverIndex === i)
      )}
    </>
  )
}
