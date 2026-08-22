import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GlobalTabRegistration } from '../../extensions/registry'
import type { SessionView } from '../../sidebar/view-model'
import { useExtensionRegistry } from '../../extensions/registry'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSessionStore } from '../../stores/session.store'
import { useSettingsStore } from '../../stores/settings.store'
import { useTerminalSession } from '../../hooks/useTerminalSession'
import { buildGroups } from '../../sidebar/view-model'
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
import { CreateProjectDialog } from './CreateProjectDialog'
import { SidebarHeader } from './SidebarHeader'
import { ScratchSection } from './ScratchSection'
import { ExtensionFooter } from './ExtensionFooter'
import { FilterNotice } from './FilterNotice'
import { ScopeMenu } from './ScopeMenu'
import { SessionGroup } from './SessionGroup'
import { SessionRow } from './SessionRow'
import { ViewBar } from './ViewBar'
import { BranchSwitcher } from './BranchSwitcher'
import './UnifiedSidebar.css'

interface UnifiedSidebarProps {
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
const DEFAULT_WIDTH = 260
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
}: UnifiedSidebarProps): JSX.Element {
  const {
    workspaces,
    activeWorkspaceId,
    projectsByWorkspaceId,
    setActiveProject,
    setActiveWorkspace,
    loadProjects,
    reorderWorkspaces,
    deleteProject,
    renameProject,
    resolveActiveCwd,
  } = useWorkspaceStore()
  const sessionStore = useSessionStore()
  const { getScratchSessions, sessions, projectViews, isSessionBusy, getBellCountForSession } =
    sessionStore
  const { resolveSettings } = useSettingsStore()
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
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<{
    id: string
    name: string
  } | null>(null)
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

  function saveAsNewView(name: string): void {
    const id = `custom.${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    const base = views.find((v) => v.id === activeViewId) ?? views[0]
    persist([...views.filter((v) => v.id !== id), { ...base, id, name, builtIn: undefined }])
    setActiveViewId(id)
  }

  function deleteView(id: string): void {
    persist(views.filter((v) => v.id !== id))
    if (activeViewId === id) setActiveViewId(DEFAULT_VIEW_ID)
  }

  function showAll(): void {
    setSearchQuery('')
    setActiveViewId(DEFAULT_VIEW_ID)
  }

  const allProjects = useMemo(
    () => workspaces.flatMap((ws) => projectsByWorkspaceId.get(ws.id) ?? []),
    [workspaces, projectsByWorkspaceId]
  )

  const sessionList = useMemo(
    () => [...sessions.values()].filter((s) => s.status !== 'closed' || s.agentState === 'exited'),
    [sessions]
  )

  const clock = now ?? Date.now()
  const { groups, shown, total } = useMemo(
    () =>
      buildGroups(
        sessionList,
        allProjects,
        workspaces,
        view,
        clock,
        // Phase 4 replaces this constant with the configurable setting (FR-020).
        DEFAULT_STALE_AFTER_MS
      ),
    [sessionList, allProjects, workspaces, view, clock]
  )

  const projectById = useMemo(() => new Map(allProjects.map((p) => [p.id, p])), [allProjects])
  const workspaceById = useMemo(() => new Map(workspaces.map((w) => [w.id, w])), [workspaces])

  // FR-027 lists three ways to reach a scope action: the group header, the row
  // scope menu, and the command palette. This is the third.
  const registerCommand = useExtensionRegistry((s) => s.registerCommand)
  useEffect(() => {
    const disposers = allProjects.map((project) =>
      registerCommand({
        id: `core.scope.new-terminal.${project.id}`,
        label: `New terminal in ${project.name}`,
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

  function addSessionToProject(projectId: string): void {
    const project = projectById.get(projectId)
    if (!project) return
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
          onSelectView={setActiveViewId}
          onChangeView={changeActiveView}
          onSaveAsNew={saveAsNewView}
          onDeleteView={deleteView}
          hideStaleUnavailable={view.filters.staleOnly === true}
        />

        <FilterNotice shown={shown} total={total} onShowAll={showAll} />

        <div className="unified-sidebar__list">
          {groups.map((group) => {
            const project =
              group.scope?.kind === 'project' ? projectById.get(group.scope.projectId) : undefined
            const workspaceId = group.scope?.workspaceId
            const workspace = workspaceId ? workspaceById.get(workspaceId) : undefined
            const ownsWorkspaceTabs =
              workspaceId !== undefined && firstGroupKeyByWorkspace.get(workspaceId) === group.key
            const collapsed = isGroupCollapsed(collapseState, view.groupBy, group.key)

            return (
              <SessionGroup
                key={group.key}
                group={group}
                collapsed={collapsed}
                onToggleCollapse={() => toggleGroup(group.key)}
                workspaceColor={workspace?.color}
                isWorktree={project?.isWorktree}
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
                onAddSession={project ? () => addSessionToProject(project.id) : undefined}
                onRename={project ? (name) => void renameProject(project.id, name) : undefined}
                onRemove={
                  project
                    ? () => setConfirmDeleteProject({ id: project.id, name: project.name })
                    : undefined
                }
                workspaceTabs={ownsWorkspaceTabs ? workspaceTabList : undefined}
                activeWorkspaceTabId={
                  activeWorkspaceId === workspaceId ? activeWorkspaceTabId : null
                }
                onSelectWorkspaceTab={
                  workspaceId ? (tabId) => onSelectWorkspaceTab(workspaceId, tabId) : undefined
                }
              >
                {group.sessions.map((session) => (
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
          })}

          {groups.length === 0 && (
            <div className="unified-sidebar__empty">
              {searchQuery ? `No sessions match "${searchQuery}"` : 'No sessions yet'}
            </div>
          )}

          {workspaces.map((ws, index) => (
            <div
              key={ws.id}
              {...getItemProps(index)}
              className={`unified-sidebar__ws-actions${dragOverIndex === index ? ' ws-card--dnd-over' : ''}`}
            >
              <button
                className="unified-sidebar__add-project"
                onClick={() => setCreateProjectFor(ws.id)}
              >
                <span>+</span>
                <span>New project in {ws.name}</span>
              </button>
            </div>
          ))}
        </div>

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

      {createWsOpen && <CreateWorkspaceDialog onClose={() => setCreateWsOpen(false)} />}
      {createProjectFor && (
        <CreateProjectDialog
          workspaceId={createProjectFor}
          onClose={() => setCreateProjectFor(null)}
        />
      )}
      {confirmDeleteProject && (
        <ConfirmDialog
          title={`Remove project "${confirmDeleteProject.name}"?`}
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
