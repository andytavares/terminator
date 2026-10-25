import React from 'react'
import { ChevronDown, ChevronRight, Pause, Plus } from 'lucide-react'
import type { WorkspaceTabRegistration } from '../../extensions/registry'
import type { DragItemProps } from '../../hooks/useDragReorder'
import type { RepoGroup } from '../../sidebar/branch-rows'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu'
import { activateOnKey, afterClosing, clickOnly, useRowMenu } from './row-events'
import './RepoHeader.css'

export interface RepoHeaderProps {
  group: RepoGroup
  collapsed: boolean
  onToggleCollapse: () => void
  onAddBranch?: () => void
  onEdit?: () => void
  onRemove?: () => void
  /** Opens the repo's folder in the user's editor. */
  onOpenInEditor?: () => void
  editorName?: string
  /**
   * Repo-scoped extension buttons, revealed on hover. The contribution contract
   * is unchanged; only where they are drawn moved (FR-037).
   */
  workspaceTabs?: WorkspaceTabRegistration[]
  activeWorkspaceTabId?: string | null
  onSelectWorkspaceTab?: (tabId: string) => void
  /**
   * The folder path, home-abbreviated. Shown as the name's tooltip, not the
   * row's: a native tooltip is drawn over whatever is beneath it, so a
   * full-width trigger meant hovering anywhere on the row blanketed the
   * branches below it.
   */
  pathLabel?: string
  /** Drawn before the name in place of the colour swatch: a task header's state glyph. */
  leading?: React.ReactNode
  /**
   * Drag-to-reorder for the repo list. It used to hang off the "new branch"
   * row that closed each repo's run; with that row gone the header is the only
   * thing standing for a repo, so it carries the handle.
   */
  dragProps?: DragItemProps
  dragOver?: boolean
}

/**
 * One repo, and the header its branches sit under.
 *
 * Three things at rest: the name, the branch count, and — only while collapsed —
 * a marker that something inside is waiting on you. The colour swatch is not
 * counted, on the same reasoning FR-026 excludes a row's rail: it is the repo's
 * identity rather than a fact about it.
 *
 * Everything else appears on hover, in space that is already reserved, so
 * revealing it never moves what was already on the row (FR-031).
 */
export function RepoHeader(props: RepoHeaderProps): JSX.Element {
  const { group, collapsed, onToggleCollapse, dragProps, dragOver = false } = props
  const { menu, openMenu, closeMenu } = useRowMenu()

  return (
    <>
      <div
        {...dragProps}
        className={`repo-header${dragOver ? ' repo-header--dnd-over' : ''}`}
        style={group.color ? { ['--ws-color' as string]: group.color } : undefined}
        onClick={onToggleCollapse}
        onContextMenu={repoMenuItems(props, closeMenu).length > 0 ? openMenu : undefined}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onKeyDown={activateOnKey(onToggleCollapse)}
      >
        <RepoHeaderContent {...props} />
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onDismiss={closeMenu}
          items={repoMenuItems(props, closeMenu)}
        />
      )}
    </>
  )
}

/** Chevron, swatch, name, the collapsed waiting marker, hover actions, then the count. */
function RepoHeaderContent(props: RepoHeaderProps): JSX.Element {
  const { group, collapsed, pathLabel, leading } = props
  return (
    <>
      <span className="repo-header__chevron" aria-hidden="true">
        {collapsed ? <ChevronRight /> : <ChevronDown />}
      </span>
      {leading ?? (group.color && <span className="repo-header__swatch" aria-hidden="true" />)}
      <span className="repo-header__name" title={pathLabel || group.folderPath || undefined}>
        {group.label}
      </span>

      {/* A collapsed repo must still be able to say something inside it is
          waiting, or hiding a repo hides the one thing you needed to see. */}
      {collapsed && group.needsYou && (
        <span className="repo-header__needs-you" aria-label="A branch here is waiting on you">
          <Pause aria-hidden="true" />
        </span>
      )}

      <RepoHoverActions {...props} />

      {/* Last on the row: every count in the sidebar lands in one column,
          and revealing the actions to its left cannot move it. */}
      <span className="repo-header__count">{group.branchCount}</span>
    </>
  )
}

/** The repo's extension buttons and New branch, revealed on hover in reserved space. */
function RepoHoverActions(props: RepoHeaderProps): JSX.Element {
  const { group, onAddBranch, workspaceTabs = [], activeWorkspaceTabId } = props
  return (
    <span className="repo-header__hover">
      {workspaceTabs.map((tab) => (
        <WorkspaceTabButton
          key={tab.id}
          tab={tab}
          on={tab.id === activeWorkspaceTabId}
          onSelect={() => props.onSelectWorkspaceTab?.(tab.id)}
        />
      ))}
      {onAddBranch && (
        <button
          type="button"
          className="repo-header__action"
          aria-label={`New branch in ${group.label}`}
          title="New branch"
          onClick={clickOnly(onAddBranch)}
        >
          <Plus aria-hidden="true" />
        </button>
      )}
    </span>
  )
}

interface WorkspaceTabButtonProps {
  tab: WorkspaceTabRegistration
  on: boolean
  onSelect: () => void
}

/** One extension's repo button: its icon, else its label's first letter. */
function WorkspaceTabButton({ tab, on, onSelect }: WorkspaceTabButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={`repo-header__action${on ? ' repo-header__action--on' : ''}`}
      aria-label={tab.label}
      title={tab.label}
      onClick={clickOnly(onSelect)}
    >
      {tab.icon ?? tab.label[0]}
    </button>
  )
}

/** Open in the editor (closing the menu first), then Edit and Remove workspace. */
function repoMenuItems(
  { onOpenInEditor, editorName, onEdit, onRemove }: RepoHeaderProps,
  closeMenu: () => void
): ContextMenuItem[] {
  const items: ContextMenuItem[] = []
  if (onOpenInEditor) {
    const label = editorName ? `Open in ${editorName}` : 'Open in editor'
    items.push({ label, onSelect: afterClosing(closeMenu, onOpenInEditor) })
  }
  if (onEdit) items.push({ label: 'Edit workspace', separatorBefore: true, onSelect: onEdit })
  if (onRemove) items.push({ label: 'Remove workspace', danger: true, onSelect: onRemove })
  return items
}
