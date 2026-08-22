import React, { useState } from 'react'
import { ChevronDown, ChevronRight, FolderGit2, GitBranch } from 'lucide-react'
import type { WorkspaceTabRegistration } from '../../extensions/registry'
import type { Group } from '../../sidebar/view-model'
import { ContextMenu, closeAllContextMenus } from '../ContextMenu'
import './SessionGroup.css'

export interface SessionGroupProps {
  group: Group
  collapsed: boolean
  onToggleCollapse: () => void
  /** Colour band inherited from the group's workspace. */
  workspaceColor?: string
  /** True for a worktree-backed project, which gets the worktree icon. */
  isWorktree?: boolean
  busy?: boolean
  /** Rendered inside the header for project-scoped groups. */
  branchSwitcher?: React.ReactNode
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
export function SessionGroup({
  group,
  collapsed,
  onToggleCollapse,
  workspaceColor,
  isWorktree,
  busy,
  branchSwitcher,
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
    if (!onRename && !onRemove) return
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
    ...(onRemove
      ? [{ label: 'Remove', danger: true, separatorBefore: true, onSelect: onRemove }]
      : []),
  ]

  return (
    <div
      className={`session-group${isScope ? ' session-group--scope' : ''}`}
      style={
        workspaceColor
          ? ({ ['--ws-color' as string]: workspaceColor } as React.CSSProperties)
          : undefined
      }
    >
      <div
        className="session-group__header"
        onClick={onToggleCollapse}
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

        {group.scope?.kind === 'project' && (
          <span className="session-group__icon">
            {isWorktree ? <FolderGit2 size={12} /> : <GitBranch size={12} />}
          </span>
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
          <span className="session-group__label" title={group.label}>
            {group.label}
          </span>
        )}

        {busy && <span className="session-group__busy" />}

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

      {branchSwitcher && !collapsed && (
        <div className="session-group__branch-row" onClick={(e) => e.stopPropagation()}>
          {branchSwitcher}
        </div>
      )}

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
