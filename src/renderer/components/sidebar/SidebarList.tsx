import React, { useMemo, useState } from 'react'
import type { Workspace } from '../../../shared/types/index'
import type { WorkspaceTabRegistration } from '../../extensions/registry'
import type { GroupKey } from '../../sidebar/view-model'
import type { WorkItem } from '../../sidebar/work-item'
import {
  sessionIssueKeys,
  type BranchRow as BranchRowData,
  type BranchTerminal,
  type RepoGroup,
} from '../../sidebar/branch-rows'
import { abbreviatePath } from '../../sidebar/branch-display'
import {
  isCollapsed,
  loadCollapseState,
  saveCollapseState,
  toggleCollapsed,
  TERMINALS_NAMESPACE,
  type CollapseNamespace,
} from '../../sidebar/collapse-state'
import { useDragReorder, type DragItemProps } from '../../hooks/useDragReorder'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { useChangeStatsStore } from '../../stores/change-stats.store'
import { openFolderInEditor, type BranchActions } from './branch-actions'
import type { SidebarDialog } from './SidebarDialogs'
import type { SidebarData } from './useSidebarRows'
import type { IssueMenuActions } from './issue-menu-items'
import { openAddToTask } from '../tasks/add-to-task'
import { laneOf } from '../../sidebar/task-groups'
import { RepoHeader } from './RepoHeader'
import { BranchRow } from './BranchRow'
import { TerminalRow } from './TerminalRow'
import { useShownInMain } from './useShownInMain'
import { branchStandsForShown, repoStandsForShown } from '../../sidebar/shown-in-main'

/** Which repos and branch terminal lists are folded away, remembered across launches. */
export function useSidebarCollapse() {
  const [state, setState] = useState(loadCollapseState)
  const toggleGroup = (namespace: CollapseNamespace, key: string): void => {
    const next = toggleCollapsed(state, namespace, key)
    setState(next)
    saveCollapseState(next)
  }
  return {
    isCollapsed: (namespace: GroupKey, key: string) => isCollapsed(state, namespace, key),
    toggle: toggleGroup,
    /** Whether a branch's terminals are listed. The polarity is *collapsed*, like every other
     * group here — but a branch's terminals start hidden, because the sidebar's job is still to
     * stop at the branch by default (ADR-035) and expanding is how you go further. */
    terminalsExpanded: (projectId: string) => isCollapsed(state, TERMINALS_NAMESPACE, projectId),
  }
}

/** What every row in the list draws from and acts through. */
export interface RowContext {
  data: SidebarData
  actions: BranchActions
  collapse: ReturnType<typeof useSidebarCollapse>
  groupBy: GroupKey
  openDialog: (dialog: SidebarDialog) => void
  removeSessionLink: (sessionId: string) => void
  /** Each session's own work item, by session id. */
  workItems: Map<string, WorkItem | null>
  /** Commits a drag in the drawn order, and switches the view to Manual so it stays. */
  reorder: {
    repos: (drawn: Workspace[]) => void
    branches: (id: string, rows: BranchRowData[]) => void
  }
  clock: number
  homeDir: string | undefined
  editorName: string | undefined
  workspaceTabs: WorkspaceTabRegistration[]
  activeWorkspaceTabId: string | null
  onSelectWorkspaceTab: (workspaceId: string, tabId: string) => void
}

/** The repos, in the order drawn, each with its branches. A drag reorders the list as drawn,
 * which is not the list as stored the moment a computed sort or a filter is on. So the hook is
 * given the drawn repos, and the context folds the result back into the stored list. */
export function RepoGroupList({ groups, ctx }: { groups: RepoGroup[]; ctx: RowContext }) {
  const { workspaceById } = ctx.data
  const drawn = useMemo(
    () => groups.flatMap((g) => workspaceById.get(g.workspaceId) ?? []),
    [groups, workspaceById]
  )
  const { dragOverIndex, getItemProps } = useDragReorder(drawn, ctx.reorder.repos)
  return (
    <>
      {groups.map((group) => {
        const index = drawn.findIndex((w) => w.id === group.workspaceId)
        const drag =
          index === -1 ? undefined : { props: getItemProps(index), over: dragOverIndex === index }
        return <RepoSection key={group.workspaceId} group={group} drag={drag} ctx={ctx} />
      })}
    </>
  )
}

interface Drag {
  props: DragItemProps | undefined
  over: boolean
}

interface RepoSectionProps {
  group: RepoGroup
  drag: Drag | undefined
  ctx: RowContext
}

/** One repo's header and, unless it is collapsed, its branches. */
function RepoSection({ group, drag, ctx }: RepoSectionProps): JSX.Element {
  const workspace = ctx.data.workspaceById.get(group.workspaceId)
  const collapsed = ctx.collapse.isCollapsed(ctx.groupBy, group.workspaceId)
  const active = useWorkspaceStore((s) => s.activeWorkspaceId === group.workspaceId)
  const branchIds = group.branches.map((branch) => branch.projectId)
  const selected = repoStandsForShown(useShownInMain(), collapsed, branchIds)
  return (
    <>
      <RepoHeader
        group={group}
        selected={selected}
        pathLabel={abbreviatePath(group.folderPath, ctx.homeDir)}
        dragProps={drag?.props}
        dragOver={drag?.over ?? false}
        collapsed={collapsed}
        onToggleCollapse={() => ctx.collapse.toggle(ctx.groupBy, group.workspaceId)}
        editorName={ctx.editorName}
        {...(workspace ? repoActions(workspace, active, ctx) : {})}
      />
      {!collapsed && (
        <BranchList
          rows={group.branches}
          workspace={workspace}
          // Under "no grouping" one list holds every repo's branches and the
          // stores have nowhere to write an order that crosses repos, so there
          // is nothing to drag there.
          onReorder={workspace ? (rows) => ctx.reorder.branches(workspace.id, rows) : undefined}
          ctx={ctx}
        />
      )}
    </>
  )
}

/** What a repo header offers once there is a workspace behind it. */
function repoActions(workspace: Workspace, active: boolean, ctx: RowContext) {
  const { openDialog } = ctx
  return {
    onAddBranch: () => openDialog({ kind: 'create-branch', workspaceId: workspace.id }),
    onEdit: () => openDialog({ kind: 'edit-workspace', workspace }),
    onRemove: () => openDialog({ kind: 'remove-workspace', workspace }),
    onOpenInEditor: () => openFolderInEditor(workspace.folderPath),
    workspaceTabs: ctx.workspaceTabs,
    activeWorkspaceTabId: active ? ctx.activeWorkspaceTabId : null,
    onSelectWorkspaceTab: (tabId: string) => ctx.onSelectWorkspaceTab(workspace.id, tabId),
  }
}

interface BranchListProps {
  rows: BranchRowData[]
  workspace: Workspace | undefined
  /** Absent where a manual order has nowhere to be written. */
  onReorder?: (rows: BranchRowData[]) => void
  ctx: RowContext
}

/** One repo's branches, drag-reorderable. A component rather than a loop in the parent because
 * each repo needs its own drag state and a hook cannot be called per iteration. */
function BranchList({ rows, workspace, onReorder, ctx }: BranchListProps): JSX.Element {
  const { dragOverIndex, getItemProps } = useDragReorder(rows, (reordered) =>
    onReorder?.(reordered)
  )
  return (
    <>
      {rows.map((row, i) => (
        <BranchEntry
          key={row.projectId}
          row={row}
          workspace={workspace}
          drag={{ props: onReorder ? getItemProps(i) : undefined, over: dragOverIndex === i }}
          ctx={ctx}
        />
      ))}
    </>
  )
}

interface BranchEntryProps {
  row: BranchRowData
  workspace: Workspace | undefined
  drag: Drag
  ctx: RowContext
}

/** A branch's row and, once expanded, the terminals under it. */
export function BranchEntry({ row, workspace, drag, ctx }: BranchEntryProps): JSX.Element {
  const { projectId } = row
  const expanded = ctx.collapse.terminalsExpanded(projectId)
  const listed = expanded ? listedSessionIds(row.terminals) : []
  const selected = branchStandsForShown(useShownInMain(), projectId, listed)
  return (
    <>
      <BranchRow
        {...useBranchRowProps(row, workspace, ctx)}
        selected={selected}
        dragProps={drag.props}
        dragOver={drag.over}
        expanded={expanded}
        onToggleExpanded={() => ctx.collapse.toggle(TERMINALS_NAMESPACE, projectId)}
      />
      {/* The terminals under this branch, and the panes under each of them.
          Drawn here rather than inside BranchRow so a row stays one row —
          the same shape the repo header and its branches already use. */}
      {expanded && <TerminalEntries projectId={projectId} terminals={row.terminals} ctx={ctx} />}
    </>
  )
}

/** Every terminal and pane a branch lists under it once expanded. */
function listedSessionIds(terminals: BranchTerminal[]): string[] {
  return terminals.flatMap((terminal) => [
    terminal.sessionId,
    ...terminal.panes.map((pane) => pane.sessionId),
  ])
}

/** What a branch row shows (its key and change counts) and what it does. */
function useBranchRowProps(row: BranchRowData, workspace: Workspace | undefined, ctx: RowContext) {
  const { projectId } = row
  const project = ctx.data.projectById.get(projectId)
  requestChangeStats(
    projectId,
    project && (project.worktreePath ?? workspace?.folderPath),
    ctx.clock
  )
  const issueKey = useIntegrationsStore((s) => s.linkFor(projectId)?.key ?? null)
  return {
    row,
    colour: workspace?.color,
    now: ctx.clock,
    issueKey,
    onIssueClick: () => useIntegrationsStore.getState().openDrawer(projectId),
    sessionIssueKeys: sessionIssueKeys(row.terminals),
    changeStats: useChangeStatsStore((s) => s.statsFor(projectId)?.stats),
    editorName: ctx.editorName,
    issueActions: issueActionsFor(projectId, issueKey),
    onAddToTask: project && workspace ? () => openAddToTask(laneOf(project, workspace)) : undefined,
    ...branchRowActions(row, project?.gitBranch === undefined && project !== undefined, ctx),
  }
}

/** Selecting, starting a terminal, renaming, removing, opening and the repo's actions. */
function branchRowActions(row: BranchRowData, renamable: boolean, ctx: RowContext) {
  const { projectId } = row
  const { actions } = ctx
  return {
    onSelect: () => actions.selectBranch(projectId),
    onAddTerminal: () => actions.addTerminal(projectId),
    // A branch is named by its branch (ADR-034), so there is nothing to
    // rename. A branch in a folder that is not a repo has no branch, and
    // its stored name is the only name it has.
    onRename: renamable
      ? (name: string) => void useWorkspaceStore.getState().renameProject(projectId, name)
      : undefined,
    onRemove: () => ctx.openDialog({ kind: 'remove-branch', projectId, name: row.label }),
    onOpenInEditor: () => openFolderInEditor(actions.folderForBranch(projectId)),
    repoActions: ctx.workspaceTabs.map((tab) => ({
      id: tab.id,
      label: tab.label,
      onSelect: () => ctx.onSelectWorkspaceTab(row.workspaceId, tab.id),
    })),
  }
}

/** Asks for a branch's change volume each time its row renders — the store answers from its
 * cache inside the TTL — and never awaits the answer. */
function requestChangeStats(projectId: string, cwd: string | undefined, now: number): void {
  if (cwd) useChangeStatsStore.getState().ensure(projectId, cwd, now)
}

/** One definition of the branch's issue actions, handed to the row's menu. */
function issueActionsFor(projectId: string, issueKey: string | null): IssueMenuActions {
  const integrations = useIntegrationsStore.getState
  return {
    issueKey,
    onLinkIssue: () => integrations().openLinkDialog(projectId),
    onOpenIssue: () => {
      const issue = integrations().issueFor(projectId)
      if (issue !== null) void window.electronAPI.shell.openExternal(issue.url)
    },
    onCopyIssueKey: () => {
      const link = integrations().linkFor(projectId)
      if (link !== null) void navigator.clipboard?.writeText(link.key)
    },
    onUnlinkIssue: () => void integrations().unlinkIssue(projectId),
  }
}

interface TerminalEntriesProps {
  projectId: string
  terminals: BranchTerminal[]
  ctx: RowContext
}

function TerminalEntries({ projectId, terminals, ctx }: TerminalEntriesProps): JSX.Element {
  const shown = useShownInMain()?.sessionId ?? null
  const entry = (terminal: BranchTerminal, nested: boolean): JSX.Element => (
    <TerminalRow
      key={terminal.sessionId}
      terminal={terminal}
      nested={nested}
      selected={shown === terminal.sessionId}
      onSelect={() => ctx.actions.selectSession(terminal.sessionId)}
      onClose={() => ctx.actions.closeTerminal(projectId, terminal.sessionId)}
      onLinkIssue={() => ctx.openDialog({ kind: 'link-session', sessionId: terminal.sessionId })}
      onRemoveLink={() => ctx.removeSessionLink(terminal.sessionId)}
    />
  )
  return (
    <>
      {terminals.map((terminal) => (
        <React.Fragment key={terminal.sessionId}>
          {entry(terminal, false)}
          {terminal.panes.map((pane) => entry(pane, true))}
        </React.Fragment>
      ))}
    </>
  )
}
