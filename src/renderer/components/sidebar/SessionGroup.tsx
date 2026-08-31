import React, { useState } from 'react'
import { ChevronDown, ChevronRight, GitBranch, GitFork } from 'lucide-react'
import type { WorkspaceTabRegistration } from '../../extensions/registry'
import type { Group } from '../../sidebar/view-model'
import type { ChangeStats } from '../../../shared/schemas/git.schema'
import { ContextMenu, closeAllContextMenus } from '../ContextMenu'
import { issueMenuItems, type IssueMenuActions } from './issue-menu-items'
import './SessionGroup.css'

export interface SessionGroupProps {
  group: Group
  collapsed: boolean
  onToggleCollapse: () => void
  /** Colour band inherited from the group's workspace. */
  workspaceColor?: string
  /**
   * What this branch is called — its branch name. Passed pre-computed so the
   * component holds no display rule.
   */
  branchName?: string
  /** True when the branch has its own working copy on disk. */
  isWorktree?: boolean
  /** Where that working copy is; revealed on hover.  */
  worktreePath?: string
  /**
   * Uncommitted change volume. `undefined` means not asked for yet, `null`
   * means git could not answer — both render as nothing, because change volume
   * is decorative and a git failure must not produce a broken-looking row.
   */
  changeStats?: ChangeStats | null
  /** Folder path of the repo, shown on a repo group header. */
  repoPath?: string
  /**
   * The workspace this project belongs to, named in the header. The colour band
   * alone cannot answer "which workspace is this?" — a filtered list of project
   * headers is otherwise a list of names with no home.
   */
  workspaceName?: string
  /** True for a project group rendered inside its workspace's group. */
  nested?: boolean
  busy?: boolean
  /** True when this group's scope is the active project. */
  isActiveScope?: boolean
  /**
   * The attached issue's badge, for a group whose scope is a project. Passed
   * as a node rather than as data so the sidebar's view-model stays ignorant
   * of issue trackers entirely.
   */
  issueBadge?: React.ReactNode
  /**
   * The issue actions for this group's project.
   *
   * The header's own menu is what a right-click reaches when the sidebar is
   * grouped by project — which is the default — so these have to be here as
   * well as on ScopeMenu, not only there.
   */
  issueActions?: IssueMenuActions
  /**
   * Selects the group's scope. FR-026 requires the header to host everything
   * the tree's project row hosted, and that row's primary action was selecting
   * the project — so a header click selects, and the chevron owns collapse.
   */
  onSelectScope?: () => void
  onAddSession?: () => void
  /** Selects every session in this group; offered only where bulk close is. */
  onSelectAll?: () => void
  /** Commits an inline rename of the group's scope. */
  onRename?: (name: string) => void
  onRemove?: () => void
  /**
   * Workspace-scoped extension buttons, revealed on hover. Passed only for the
   * group that owns the workspace, so they appear exactly once per workspace.
   */
  workspaceTabs?: WorkspaceTabRegistration[]
  activeWorkspaceTabId?: string | null
  onSelectWorkspaceTab?: (tabId: string) => void
  children: React.ReactNode
}

/**
 * A group header. When the group's key is a scope — a project or a workspace —
 * the header IS the row the tree used to have, and hosts everything that row
 * hosted, including the hover-revealed extension buttons. For non-scope
 * groupings it degrades to a label and a count, and the scope actions move to
 * the rows instead (see ScopeMenu).
 */
/**
 * A branch with its own working copy reads differently from a plain checkout —
 * which tree a command is about to run in is the safety-relevant bit, and the
 * sidebar never used to say.
 */
function BranchGlyph({
  isWorktree,
  worktreePath,
}: {
  isWorktree: boolean
  worktreePath?: string
}): JSX.Element {
  const Glyph = isWorktree ? GitFork : GitBranch
  return (
    <Glyph
      className="session-group__branch-glyph"
      data-kind={isWorktree ? 'worktree' : 'branch'}
      aria-hidden="true"
      {...(worktreePath ? { title: worktreePath } : {})}
    />
  )
}

export function SessionGroup({
  group,
  collapsed,
  onToggleCollapse,
  workspaceColor,
  workspaceName,
  branchName,
  isWorktree,
  worktreePath,
  changeStats,
  repoPath,
  nested,
  busy,
  isActiveScope,
  issueBadge,
  issueActions,
  onSelectScope,
  onAddSession,
  onSelectAll,
  onRename,
  onRemove,
  workspaceTabs,
  activeWorkspaceTabId,
  onSelectWorkspaceTab,
  children,
}: SessionGroupProps): JSX.Element {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [renameValue, setRenameValue] = useState<string | null>(null)
  const isScope = group.scope !== undefined

  function commitRename(): void {
    const trimmed = renameValue?.trim()
    if (trimmed && trimmed !== group.label) onRename?.(trimmed)
    setRenameValue(null)
  }

  function handleContextMenu(e: React.MouseEvent): void {
    if (!onRename && !onRemove && issueActions?.onLinkIssue === undefined) return
    e.preventDefault()
    closeAllContextMenus()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  const menuItems = [
    ...(onRename
      ? [
          {
            label: 'Rename',
            onSelect: () => {
              setCtxMenu(null)
              setRenameValue(group.label)
            },
          },
        ]
      : []),
    ...issueMenuItems(issueActions ?? {}, () => setCtxMenu(null)),
    ...(onRemove
      ? [{ label: 'Remove', danger: true, separatorBefore: true, onSelect: onRemove }]
      : []),
  ]

  return (
    <div
      className={`session-group${isScope ? ' session-group--scope' : ''}${
        isActiveScope ? ' session-group--active' : ''
      }${nested ? ' session-group--nested' : ''}`}
      style={
        workspaceColor
          ? ({ ['--ws-color' as string]: workspaceColor } as React.CSSProperties)
          : undefined
      }
    >
      <div
        className="session-group__header"
        onClick={onSelectScope ?? onToggleCollapse}
        onContextMenu={handleContextMenu}
      >
        <button
          className="session-group__chevron"
          title={collapsed ? 'Expand' : 'Collapse'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleCollapse()
          }}
        >
          {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
        </button>

        {isWorktree !== undefined && (
          <BranchGlyph isWorktree={isWorktree} worktreePath={worktreePath} />
        )}

        {renameValue !== null ? (
          <input
            className="session-group__rename-input"
            value={renameValue}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') setRenameValue(null)
              e.stopPropagation()
            }}
          />
        ) : (
          <>
            {/* The label holds the name and nothing else, so it reads cleanly
                on its own; everything qualifying it sits beside it. */}
            <span className="session-group__label" title={branchName ?? group.label}>
              {branchName ?? group.label}
            </span>
            {workspaceName && (
              <span className="session-group__workspace" title={workspaceName}>
                {workspaceName}
              </span>
            )}
            {repoPath && (
              <span className="session-group__repo-path" title={repoPath}>
                {repoPath}
              </span>
            )}
          </>
        )}

        {busy && <span className="session-group__busy" />}

        {issueBadge}

        {workspaceTabs && workspaceTabs.length > 0 && (
          <div className="session-group__ws-tabs" onClick={(e) => e.stopPropagation()}>
            {workspaceTabs.map((tab) => (
              <button
                key={tab.id}
                className={`session-group__ws-tab${activeWorkspaceTabId === tab.id ? ' session-group__ws-tab--active' : ''}`}
                title={tab.label}
                onClick={() => onSelectWorkspaceTab?.(tab.id)}
              >
                {tab.icon ?? tab.label[0]}
              </button>
            ))}
          </div>
        )}

        {isWorktree && (
          <span className="session-group__worktree-tag" title={worktreePath}>
            worktree
          </span>
        )}

        {changeStats && (changeStats.added > 0 || changeStats.removed > 0) && (
          <span className="session-group__stats">
            <span className="session-group__stats-add">+{changeStats.added}</span>
            <span className="session-group__stats-del">&minus;{changeStats.removed}</span>
          </span>
        )}

        <span className="session-group__count">{group.count}</span>

        {onSelectAll && (
          <button
            className="session-group__select-all"
            title="Select all in group"
            onClick={(e) => {
              e.stopPropagation()
              onSelectAll()
            }}
          >
            all
          </button>
        )}

        {onAddSession && (
          <button
            className="session-group__add"
            title="New terminal"
            onClick={(e) => {
              e.stopPropagation()
              onAddSession()
            }}
          >
            +
          </button>
        )}
      </div>

      {!collapsed && <div className="session-group__sessions">{children}</div>}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onDismiss={() => setCtxMenu(null)}
          items={menuItems}
        />
      )}
    </div>
  )
}
