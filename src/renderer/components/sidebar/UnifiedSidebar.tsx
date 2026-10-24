import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Workspace } from '../../../shared/types/index'
import { useExtensionRegistry } from '../../extensions/registry'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useChangeStatsStore } from '../../stores/change-stats.store'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { useSessionRecordsStore } from '../../stores/session-records.store'
import type { BranchRow as BranchRowData } from '../../sidebar/branch-rows'
import { DEFAULT_VIEW_ID } from '../../sidebar/views'
import { mergeReorder } from '../../sidebar/manual-order'
import type { WorkItem } from '../../sidebar/work-item'
import { useDismissSurfaceOnClick } from '../../hooks/useDismissSurfaceOnClick'
import { useSessionFacts } from '../session/useSessionFacts'
import { SidebarHeader } from './SidebarHeader'
import { FilterMenu } from './FilterMenu'
import { DisplayMenu } from './DisplayMenu'
import { useBranchActions } from './branch-actions'
import { IssueDialogs, SidebarDialogs, useSidebarDialog } from './SidebarDialogs'
import { RepoGroupList, useSidebarCollapse, type RowContext } from './SidebarList'
import { TaskGroupList } from './TaskSections'
import { ScratchSection } from './ScratchSection'
import { useSidebarData, useSidebarRows, type SidebarData } from './useSidebarRows'
import { useSidebarViews, type SidebarViews } from './useSidebarViews'
import { useSidebarWidth } from './useSidebarWidth'
import './UnifiedSidebar.css'

interface UnifiedSidebarProps {
  activeWorkspaceTabId: string | null
  onSelectWorkspaceTab: (workspaceId: string, tabId: string) => void
  onSelectProject?: () => void
  onNewScratch: () => void
  activeScratchSessionId: string | null
  onSelectScratchSession: (sessionId: string) => void
  visible: boolean
  /** Injected by tests so relative times and staleness are deterministic. */
  now?: number
  /** Initial saved view. Phase 5's view bar drives this through state. */
  initialViewId?: string
}

export function UnifiedSidebar(props: UnifiedSidebarProps): JSX.Element {
  const { width, sidebarRef, onResizeMouseDown, onResizeDoubleClick } = useSidebarWidth()
  const { data, views, rows, dialogs, links, ctx } = useUnifiedSidebar(props)
  const dismissSurfaceHandlers = useDismissSurfaceOnClick()

  return (
    <>
      <div
        ref={sidebarRef}
        className={`unified-sidebar${props.visible ? '' : ' unified-sidebar--hidden'}`}
        style={{ width }}
        {...dismissSurfaceHandlers}
      >
        <SidebarControls
          views={views}
          rows={rows}
          onAddWorkspace={() => dialogs.open({ kind: 'create-workspace' })}
        />
        <SidebarListBody props={props} rows={rows} ctx={ctx} searchQuery={views.searchQuery} />
        <ResizeHandle onMouseDown={onResizeMouseDown} onDoubleClick={onResizeDoubleClick} />
      </div>
      <IssueDialogs {...data} />
      <SidebarDialogs
        dialog={dialogs.dialog}
        close={dialogs.close}
        factsBySessionId={links.factsBySessionId}
      />
    </>
  )
}

interface ListBodyProps {
  props: UnifiedSidebarProps
  rows: Rows
  ctx: RowContext
  searchQuery: string
}

/** The repos, the scratch section, and what to say when there is nothing to list. */
function SidebarListBody({ props, rows, ctx, searchQuery }: ListBodyProps): JSX.Element {
  const { groups, scratch } = rows
  return (
    <div className="unified-sidebar__list">
      {ctx.groupBy === 'task' ? (
        <TaskGroupList groups={groups} ctx={ctx} />
      ) : (
        <RepoGroupList groups={groups} ctx={ctx} />
      )}
      {(scratch.length > 0 || groups.length > 0) && (
        <ScratchSection
          scratch={scratch}
          sessions={rows.sessions}
          workItems={ctx.workItems}
          now={rows.clock}
          onNewScratch={props.onNewScratch}
          activeScratchSessionId={props.activeScratchSessionId}
          onSelectScratchSession={props.onSelectScratchSession}
        />
      )}
      {groups.length === 0 && (
        <div className="unified-sidebar__empty">
          {searchQuery ? `No branches match "${searchQuery}"` : 'No branches yet'}
        </div>
      )}
    </div>
  )
}

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void
  onDoubleClick: () => void
}

function ResizeHandle({ onMouseDown, onDoubleClick }: ResizeHandleProps): JSX.Element {
  return (
    <div
      className="unified-sidebar__resize-handle"
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      // Resizing the sidebar is not a move away from what the main area shows.
      onClick={(e) => e.stopPropagation()}
    />
  )
}

/** The list's state: its views, the rows they show, the open dialog, and the row context. */
function useUnifiedSidebar(props: UnifiedSidebarProps) {
  const views = useSidebarViews(props.initialViewId ?? DEFAULT_VIEW_ID)
  const data = useSidebarData()
  useSidebarSources(data)
  const links = useSessionLinks()
  const { view, views: saved } = views
  const rows = useSidebarRows({
    data,
    view,
    views: saved,
    now: props.now,
    workItems: links.workItems,
  })
  const dialogs = useSidebarDialog()
  const ctx = useRowContext({ props, data, views, rows, dialogs, links })
  return { data, views, rows, dialogs, links, ctx }
}

type Rows = ReturnType<typeof useSidebarRows>

interface ControlsProps {
  views: SidebarViews
  rows: Rows
  onAddWorkspace: () => void
}

/** Search, then the Filter and Display menus, in the header. */
function SidebarControls({ views, rows, onAddWorkspace }: ControlsProps): JSX.Element {
  const { view, searchQuery, setSearchQuery, changeActiveView } = views
  return (
    <SidebarHeader
      onSearchFocus={() => {}}
      onAddWorkspace={onAddWorkspace}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onSearchClear={() => setSearchQuery('')}
    >
      <FilterMenu
        views={views.views}
        activeViewId={views.activeViewId}
        counts={rows.viewCounts}
        onSelectView={views.setActiveViewId}
        onChangeView={changeActiveView}
        hideStaleUnavailable={view.filters.staleOnly === true}
        shown={rows.shown}
        total={rows.total}
        onShowAll={views.showAll}
      />
      <DisplayMenu view={view} onChangeView={changeActiveView} />
    </SidebarHeader>
  )
}

/** Keeps what the list is built from loaded and fresh. */
function useSidebarSources({ workspaces, projectsByWorkspaceId, allProjects }: SidebarData): void {
  // Eager-load projects for every workspace that has not been fetched yet.
  // The flat list shows all workspaces at once, so we cannot rely on
  // setActiveWorkspace to trigger loadProjects one at a time.
  const loadProjects = useWorkspaceStore((s) => s.loadProjects)
  useEffect(() => {
    for (const ws of workspaces) {
      if (!projectsByWorkspaceId.has(ws.id)) void loadProjects(ws.id)
    }
  }, [workspaces, projectsByWorkspaceId, loadProjects])

  // Coming back to the window is the cheapest moment to notice that the working
  // trees moved on while you were away.
  const invalidateAllStats = useChangeStatsStore((s) => s.invalidateAll)
  useEffect(() => {
    window.addEventListener('focus', invalidateAllStats)
    return () => window.removeEventListener('focus', invalidateAllStats)
  }, [invalidateAllStats])

  useTrackerLinks(allProjects)
}

/** The sidebar's view model knows nothing about issue trackers; it deals in projects. Each
 * branch's link is loaded here, by project id, and looked up by its row. */
function useTrackerLinks(allProjects: SidebarData['allProjects']): void {
  const { loadLink, subscribe, loadConnections } = useIntegrationsStore(
    useShallow((s) => ({
      loadLink: s.loadLink,
      subscribe: s.subscribe,
      loadConnections: s.loadConnections,
    }))
  )
  useEffect(() => {
    void loadConnections()
    return subscribe()
  }, [loadConnections, subscribe])

  useEffect(() => {
    for (const project of allProjects) void loadLink(project.id)
  }, [allProjects, loadLink])
}

/** A session's own link, keyed by session id, so a terminal row can draw it without the pure
 * branch-rows layer knowing trackers exist (ADR-031). */
function useSessionLinks() {
  const sessionFacts = useSessionFacts()
  const factsBySessionId = useMemo(
    () => new Map(sessionFacts.map((f) => [f.sessionId, f])),
    [sessionFacts]
  )
  const workItems = useMemo(
    () => new Map<string, WorkItem | null>(sessionFacts.map((f) => [f.sessionId, f.workItem])),
    [sessionFacts]
  )
  function remove(sessionId: string): void {
    const facts = factsBySessionId.get(sessionId)
    if (facts) void useSessionRecordsStore.getState().setLink(facts.snapshot, null)
  }
  return { factsBySessionId, workItems, remove }
}

/** Home directory and editor name, from main, so paths and menus read naturally. */
function useMachineFacts() {
  /** Home directory, so a repo's path reads as `~/repos/app` rather than in full. */
  const [homeDir, setHomeDir] = useState<string | undefined>(undefined)
  /** The editor this machine will use, so the menu can name it. */
  const [editorName, setEditorName] = useState<string | undefined>(undefined)

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

  return { homeDir, editorName }
}

interface ContextInput {
  props: UnifiedSidebarProps
  data: SidebarData
  views: SidebarViews
  rows: Rows
  dialogs: ReturnType<typeof useSidebarDialog>
  links: ReturnType<typeof useSessionLinks>
}

/** Everything the rows draw from and act through, gathered once per render. */
function useRowContext({ props, data, views, rows, dialogs, links }: ContextInput): RowContext {
  const { sessionList } = rows
  const actions = useBranchActions({ data, sessionList, onSelectProject: props.onSelectProject })
  const collapse = useSidebarCollapse()
  const machine = useMachineFacts()
  const workspaceTabs = useExtensionRegistry((s) => s.workspaceTabs)
  return {
    ...machine,
    data,
    actions,
    collapse,
    clock: rows.clock,
    workItems: links.workItems,
    openDialog: dialogs.open,
    removeSessionLink: links.remove,
    groupBy: views.view.groupBy,
    reorder: manualReorder(data, views.changeActiveView),
    workspaceTabs: Array.from(workspaceTabs.values()),
    activeWorkspaceTabId: props.activeWorkspaceTabId,
    onSelectWorkspaceTab: props.onSelectWorkspaceTab,
  }
}

/**
 * Dragging is how the manual order is written. The drag reorders the list as
 * drawn; `mergeReorder` folds that back into the stored list.
 *
 * Committing it also switches the view to Manual: any other sort would
 * recompute the order on the next render and the drag would vanish, which is
 * exactly what it did.
 */
function manualReorder(
  { workspaces, projectsByWorkspaceId, projectById }: SidebarData,
  changeActiveView: SidebarViews['changeActiveView']
): RowContext['reorder'] {
  const store = useWorkspaceStore.getState
  return {
    repos: (drawn: Workspace[]) => {
      void store().reorderWorkspaces(mergeReorder(workspaces, drawn, (w) => w.id).map((w) => w.id))
      changeActiveView({ sortBy: 'manual' })
    },
    branches: (workspaceId: string, rows: BranchRowData[]) => {
      const stored = projectsByWorkspaceId.get(workspaceId) ?? []
      const dragged = rows.flatMap((row) => projectById.get(row.projectId) ?? [])
      const ids = mergeReorder(stored, dragged, (p) => p.id).map((p) => p.id)
      void store().reorderProjects(workspaceId, ids)
      changeActiveView({ sortBy: 'manual' })
    },
  }
}
