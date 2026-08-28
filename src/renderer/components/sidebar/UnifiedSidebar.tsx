import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GlobalTabRegistration } from '../../extensions/registry'
import type { Group, SessionView } from '../../sidebar/view-model'
import type { Workspace } from '../../../shared/types/index'
import { useExtensionRegistry } from '../../extensions/registry'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSessionStore } from '../../stores/session.store'
import { useSettingsStore } from '../../stores/settings.store'
import { useTerminalSession } from '../../hooks/useTerminalSession'
import { buildGroups } from '../../sidebar/view-model'
import { BellAndBusySource } from '../../sidebar/agent-state'
import { abbreviatePath, displayName, qualifiedBranchLabel } from '../../sidebar/branch-display'
import { useChangeStatsStore } from '../../stores/change-stats.store'
import { BUILT_IN_VIEWS, DEFAULT_VIEW_ID, loadViews, saveViews } from '../../sidebar/views'
import {
  isCollapsed as isGroupCollapsed,
  loadCollapseState,
  saveCollapseState,
  toggleCollapsed,
} from '../../sidebar/collapse-state'
import { useDragReorder } from '../../hooks/useDragReorder'
import { ConfirmDialog } from '../ConfirmDialog'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import { EditWorkspaceDialog } from './EditWorkspaceDialog'
import { CreateProjectDialog } from './CreateProjectDialog'
import { SidebarHeader } from './SidebarHeader'
import { ScratchSection } from './ScratchSection'
import { ExtensionFooter } from './ExtensionFooter'
import { FilterNotice } from './FilterNotice'
import { ScopeMenu } from './ScopeMenu'
import { IssueBadge } from '../integrations/IssueBadge'
import { LinkIssueDialog } from '../integrations/LinkIssueDialog'
import { IssueDrawer } from '../integrations/IssueDrawer'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { SessionGroup } from './SessionGroup'
import { SessionRow } from './SessionRow'
import { WorkspaceRow } from './WorkspaceRow'
import { ViewBar } from './ViewBar'
import { BranchSwitcher } from './BranchSwitcher'
import { BulkCloseDialog } from './BulkCloseDialog'
import './UnifiedSidebar.css'

interface UnifiedSidebarProps {
  /** Session whose note the host asked to edit (Cmd+I). */
  editNoteSessionId?: string | null
  globalTabs: GlobalTabRegistration[]
  activeGlobalTabId: string | null
  onSelectGlobalTab: (id: string) => void
  activeWorkspaceTabId: string | null
  onSelectWorkspaceTab: (workspaceId: string, tabId: string) => void
  onSelectProject?: () => void
  unreadNotifications: number
  notificationPanelOpen: boolean
  onBellClick: () => void
  scratchActive: boolean
  hasScratchSessions: boolean
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
  editNoteSessionId,
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
    deleteProject,
    deleteWorkspace,
    renameProject,
    resolveActiveCwd,
  } = useWorkspaceStore()
  const sessionStore = useSessionStore()
  const { getScratchSessions, sessions, projectViews, isSessionBusy, getBellCountForSession } =
    sessionStore
  const { resolveSettings } = useSettingsStore()
  const {
    statsFor,
    ensure: ensureChangeStats,
    invalidate: invalidateStats,
    invalidateAll: invalidateAllStats,
  } = useChangeStatsStore()
  /** Last activity seen per branch, so work in a terminal refreshes its statistics. */
  const lastActivityByBranch = useRef(new Map<string, number>())
  /** Home directory, so a repo path reads as `~/repos/app`. */
  const [homeDir, setHomeDir] = useState<string | undefined>(undefined)
  const staleAfterMs = resolveSettings().sidebar?.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
  const { createSession } = useTerminalSession()
  const workspaceTabs = useExtensionRegistry((s) => s.workspaceTabs)
  const sidebarButtons = useExtensionRegistry((s) => s.sidebarButtons)

  const scratchSessions = getScratchSessions()

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
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkCloseOpen, setBulkCloseOpen] = useState(false)
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

  const [scopeMenu, setScopeMenu] = useState<{
    x: number
    y: number
    projectId: string
  } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [collapseState, setCollapseState] = useState(loadCollapseState)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(width)
  const dragStartXRef = useRef<number | null>(null)

  const { dragOverIndex, getItemProps } = useDragReorder(workspaces, (reordered) =>
    reorderWorkspaces(reordered.map((w) => w.id))
  )

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
    if (editNoteSessionId) setNoteEditingId(editNoteSessionId)
  }, [editNoteSessionId])

  useEffect(() => {
    void window.electronAPI?.app
      ?.getInfo?.()
      .then((info) => setHomeDir(info.homeDir))
      .catch(() => setHomeDir(undefined))
  }, [])

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
  const { groups, shown, total } = useMemo(
    () => buildGroups(sessionList, allProjects, workspaces, view, clock, staleAfterMs),
    [sessionList, allProjects, workspaces, view, clock, staleAfterMs]
  )

  // What each view would show, so a chip can say "Needs me · 6" without the
  // user having to switch to it and look.
  const viewCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const v of views) {
      out[v.id] = buildGroups(sessionList, allProjects, workspaces, v, clock, staleAfterMs).shown
    }
    return out
  }, [views, sessionList, allProjects, workspaces, clock, staleAfterMs])

  const projectById = useMemo(() => new Map(allProjects.map((p) => [p.id, p])), [allProjects])
  const workspaceById = useMemo(() => new Map(workspaces.map((w) => [w.id, w])), [workspaces])

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
          )
        },
      })
    )
    return () => disposers.forEach((dispose) => dispose())
  }, [allProjects, registerCommand, createSession, resolveActiveCwd, resolveSettings])

  // Multi-select exists only in the Stale view. Extending it to every view is
  // out of scope, and offering it where nothing is safe to bulk-close would be
  // an invitation to a mistake.
  const selectionEnabled = view.filters.staleOnly === true
  const orderedIds = groups.flatMap((g) => g.sessions.map((s) => s.id))
  const lastClickedRef = useRef<string | null>(null)

  function toggleSelection(sessionId: string, shiftKey: boolean): void {
    const anchor = lastClickedRef.current
    if (shiftKey && anchor) {
      const from = orderedIds.indexOf(anchor)
      const to = orderedIds.indexOf(sessionId)
      if (from !== -1 && to !== -1) {
        const range = orderedIds.slice(Math.min(from, to), Math.max(from, to) + 1)
        setSelectedIds((prev) => [...new Set([...prev, ...range])])
        return
      }
    }
    lastClickedRef.current = sessionId
    setSelectedIds((prev) =>
      prev.includes(sessionId) ? prev.filter((id) => id !== sessionId) : [...prev, sessionId]
    )
  }

  function selectGroup(groupKey: string): void {
    const group = groups.find((g) => g.key === groupKey)
    if (!group) return
    setSelectedIds((prev) => [...new Set([...prev, ...group.sessions.map((s) => s.id)])])
  }

  function toggleGroup(key: string): void {
    const next = toggleCollapsed(collapseState, view.groupBy, key)
    setCollapseState(next)
    saveCollapseState(next)
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
    )
  }

  // Workspace-scoped extension buttons belong on the first group of each
  // workspace, so they appear exactly once per workspace however many projects
  // that workspace has (surface 2).
  const firstGroupKeyByWorkspace = new Map<string, string>()
  for (const group of groups) {
    const workspaceId = group.scope?.workspaceId
    if (workspaceId && !firstGroupKeyByWorkspace.has(workspaceId)) {
      firstGroupKeyByWorkspace.set(workspaceId, group.key)
    }
  }

  const workspaceTabList = Array.from(workspaceTabs.values())

  // Which group closes out each workspace's run, so the "new project" entry can
  // sit with the workspace it belongs to instead of in a heap at the bottom.
  const lastGroupKeyByWorkspace = new Map<string, string>()
  for (const group of groups) {
    const workspaceId = group.scope?.workspaceId
    if (workspaceId) lastGroupKeyByWorkspace.set(workspaceId, group.key)
  }
  // A workspace with no groups at all still needs a way in — but not while the
  // view is narrowed, where an empty workspace is noise the filter notice
  // already accounts for. Mirrors the same rule in the view model.
  const isNarrowed =
    view.filters.query !== undefined ||
    view.filters.states !== undefined ||
    view.filters.projectIds !== undefined ||
    view.filters.staleOnly === true
  const workspacesWithoutGroups =
    (view.groupBy === 'project' || view.groupBy === 'workspace') && !isNarrowed
      ? workspaces.filter((ws) => !lastGroupKeyByWorkspace.has(ws.id))
      : []

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

  function renderIssueBadge(projectId: string | undefined): React.ReactNode {
    if (projectId === undefined) return undefined
    const link = issueLinkFor(projectId)
    if (link === null) return undefined
    const issue = issueFor(projectId)
    return (
      <IssueBadge
        tracker={link.tracker}
        issueKey={link.key}
        state={issue?.state ?? null}
        title={issue?.title}
        onClick={() => openDrawer(projectId)}
      />
    )
  }

  /** One definition, handed to both the group header's menu and ScopeMenu. */
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
  function renderGroup(group: Group, nested: boolean): JSX.Element {
    const project =
      group.scope?.kind === 'project' ? projectById.get(group.scope.projectId) : undefined
    const workspaceId = group.scope?.workspaceId
    const workspace = workspaceId ? workspaceById.get(workspaceId) : undefined
    const ownsWorkspaceTabs =
      workspaceId !== undefined && firstGroupKeyByWorkspace.get(workspaceId) === group.key
    const collapsed = isGroupCollapsed(collapseState, view.groupBy, group.key)

    // Asking for a branch's change volume the first time its row renders, and
    // never awaiting the answer. A collapsed group costs nothing.
    const branchCwd = project ? (project.worktreePath ?? workspace?.folderPath) : undefined
    if (project && branchCwd) ensureChangeStats(project.id, branchCwd, clock)
    const statsEntry = project ? statsFor(project.id) : undefined

    return (
      <SessionGroup
        key={group.key}
        group={group}
        nested={nested}
        collapsed={collapsed}
        onToggleCollapse={() => toggleGroup(group.key)}
        workspaceColor={workspace?.color}
        branchName={project ? displayName(project) : undefined}
        isWorktree={project ? project.isWorktree : undefined}
        worktreePath={project?.worktreePath}
        changeStats={statsEntry?.stats}
        repoPath={
          group.scope?.kind === 'workspace' && workspace
            ? abbreviatePath(workspace.folderPath, homeDir)
            : undefined
        }
        // Nested under its workspace the question is already answered; anywhere
        // else a project header is a bare name with no home.
        workspaceName={project && !nested ? workspace?.name : undefined}
        busy={group.sessions.some((s) => isSessionBusy(s.id))}
        branchSwitcher={
          project && workspace ? (
            <BranchSwitcher
              project={project}
              workspaceFolderPath={workspace.folderPath}
              workspaceId={workspace.id}
            />
          ) : undefined
        }
        isActiveScope={project !== undefined && project.id === activeProjectId}
        issueBadge={renderIssueBadge(project?.id)}
        issueActions={project ? issueActionsFor(project.id) : undefined}
        onSelectScope={project ? () => selectProjectScope(project.id) : undefined}
        onAddSession={project ? () => addSessionToProject(project.id) : undefined}
        onSelectAll={selectionEnabled ? () => selectGroup(group.key) : undefined}
        onRename={project ? (name) => void renameProject(project.id, name) : undefined}
        onRemove={
          project
            ? () => setConfirmDeleteProject({ id: project.id, name: project.name })
            : undefined
        }
        workspaceTabs={ownsWorkspaceTabs ? workspaceTabList : undefined}
        activeWorkspaceTabId={activeWorkspaceId === workspaceId ? activeWorkspaceTabId : null}
        onSelectWorkspaceTab={
          workspaceId ? (tabId) => onSelectWorkspaceTab(workspaceId, tabId) : undefined
        }
      >
        {group.subgroups
          ? group.subgroups.map((subgroup) => renderGroup(subgroup, true))
          : group.sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                isActive={projectViews.get(session.projectId)?.activeSessionId === session.id}
                isBusy={isSessionBusy(session.id)}
                bellCount={getBellCountForSession(session.id)}
                workspaceColor={workspace?.color ?? ''}
                now={clock}
                projectBadge={
                  group.scope?.kind === 'project'
                    ? undefined
                    : projectById.get(session.projectId)?.name
                }
                onSetNote={(note) => sessionStore.setSessionNote(session.id, note)}
                noteEditing={noteEditingId === session.id}
                onNoteEditingChange={(editing) => setNoteEditingId(editing ? session.id : null)}
                selectable={selectionEnabled}
                selected={selectedIds.includes(session.id)}
                onToggleSelected={(shiftKey) => toggleSelection(session.id, shiftKey)}
                onScopeClick={(e) =>
                  setScopeMenu({
                    x: e.clientX,
                    y: e.clientY,
                    projectId: session.projectId,
                  })
                }
                isSubSession={session.parentSessionId !== undefined}
                onSelect={() => selectSession(session.projectId, session.id)}
                onRename={(newTitle) => sessionStore.renameSession(session.id, newTitle)}
              />
            ))}
      </SessionGroup>
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
          activeGlobalTabId={activeGlobalTabId}
          onSelectGlobalTab={onSelectGlobalTab}
          onSearchFocus={() => {}}
          onAddWorkspace={() => setCreateWsOpen(true)}
          unreadNotifications={unreadNotifications}
          onBellClick={onBellClick}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSearchClear={() => setSearchQuery('')}
        />

        <ViewBar
          views={views}
          activeViewId={activeViewId}
          counts={viewCounts}
          onSelectView={setActiveViewId}
          onChangeView={changeActiveView}
          hideStaleUnavailable={view.filters.staleOnly === true}
        />

        <FilterNotice shown={shown} total={total} onShowAll={showAll} />

        <div className="unified-sidebar__list">
          {groups.map((group) => {
            const workspaceId = group.scope?.workspaceId
            const workspace = workspaceId ? workspaceById.get(workspaceId) : undefined
            const closesWorkspace =
              workspaceId !== undefined && lastGroupKeyByWorkspace.get(workspaceId) === group.key

            return (
              <React.Fragment key={group.key}>
                {renderGroup(group, false)}

                {closesWorkspace && workspace && (
                  <div
                    {...getItemProps(workspaces.findIndex((w) => w.id === workspace.id))}
                    className={`unified-sidebar__ws-actions${
                      dragOverIndex === workspaces.findIndex((w) => w.id === workspace.id)
                        ? ' ws-card--dnd-over'
                        : ''
                    }`}
                  >
                    <WorkspaceRow
                      workspace={workspace}
                      onAddProject={() => setCreateProjectFor(workspace.id)}
                      onEdit={() => setEditWorkspace(workspace)}
                      onRemove={() => setConfirmDeleteWorkspace(workspace)}
                    />
                  </div>
                )}
              </React.Fragment>
            )
          })}

          {/* A workspace with no projects yet still needs its way in. */}
          {workspacesWithoutGroups.map((ws) => (
            <div
              key={ws.id}
              {...getItemProps(workspaces.findIndex((w) => w.id === ws.id))}
              className="unified-sidebar__ws-actions"
            >
              <WorkspaceRow
                workspace={ws}
                onAddProject={() => setCreateProjectFor(ws.id)}
                onEdit={() => setEditWorkspace(ws)}
                onRemove={() => setConfirmDeleteWorkspace(ws)}
              />
            </div>
          ))}

          {groups.length === 0 && workspacesWithoutGroups.length === 0 && (
            <div className="unified-sidebar__empty">
              {searchQuery ? `No sessions match "${searchQuery}"` : 'No sessions yet'}
            </div>
          )}
        </div>

        {selectionEnabled && selectedIds.length > 0 && (
          <div className="unified-sidebar__bulk-bar">
            <span>{selectedIds.length} selected</span>
            <button onClick={() => setSelectedIds([])}>Clear</button>
            <button className="unified-sidebar__bulk-close" onClick={() => setBulkCloseOpen(true)}>
              Close selected
            </button>
          </div>
        )}

        {/* Sidebar items are a flat global contribution, so the footer hosts
            them once per window, outside the group list and independent of how
            sessions are grouped (FR-028). */}
        <ExtensionFooter buttons={sidebarButtons} />

        <ScratchSection
          sessions={scratchSessions}
          activeSessionId={activeScratchSessionId}
          onSelectSession={onSelectScratchSession}
          onNewScratch={onNewScratch}
        />

        <div
          className="unified-sidebar__resize-handle"
          onMouseDown={handleResizeMouseDown}
          onDoubleClick={handleResizeDblClick}
        />
      </div>

      {scopeMenu &&
        (() => {
          const project = projectById.get(scopeMenu.projectId)
          if (!project) return null
          return (
            <ScopeMenu
              x={scopeMenu.x}
              y={scopeMenu.y}
              projectName={project.name}
              issueActions={issueActionsFor(project.id)}
              workspaceTabs={workspaceTabList}
              onSelectWorkspaceTab={(tabId) => onSelectWorkspaceTab(project.workspaceId, tabId)}
              onAddSession={() => addSessionToProject(project.id)}
              onRemoveProject={() =>
                setConfirmDeleteProject({ id: project.id, name: project.name })
              }
              onDismiss={() => setScopeMenu(null)}
            />
          )
        })()}

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
                projectName={project.name}
                onClose={closeDrawer}
              />
            </div>
          )
        })()}

      {bulkCloseOpen && (
        <BulkCloseDialog
          sessions={sessionList.filter((s) => selectedIds.includes(s.id))}
          projectById={projectById}
          onConfirm={(sessionIds, worktreeProjectIds) => {
            for (const id of sessionIds) void sessionStore.closeSession(id)
            // Worktree removal already happens inside project:delete, so this
            // reuses that path rather than adding a second way to do it.
            for (const projectId of worktreeProjectIds) void deleteProject(projectId)
            setSelectedIds([])
            setBulkCloseOpen(false)
          }}
          onClose={() => setBulkCloseOpen(false)}
        />
      )}

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
