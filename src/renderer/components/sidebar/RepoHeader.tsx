import React from 'react'
import { ChevronDown, ChevronRight, Pause, Plus } from 'lucide-react'
import type { WorkspaceTabRegistration } from '../../extensions/registry'
import type { DragItemProps } from '../../hooks/useDragReorder'
import type { RepoGroup } from '../../sidebar/branch-rows'
import { ContextMenu, closeAllContextMenus } from '../ContextMenu'
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
export function RepoHeader({
  group,
  collapsed,
  onToggleCollapse,
  onAddBranch,
  onEdit,
  onRemove,
  onOpenInEditor,
  editorName,
  workspaceTabs = [],
  activeWorkspaceTabId,
  onSelectWorkspaceTab,
  pathLabel,
  dragProps,
  dragOver = false,
}: RepoHeaderProps): JSX.Element {
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null)

  function handleContextMenu(e: React.MouseEvent): void {
    if (onEdit === undefined && onRemove === undefined && onOpenInEditor === undefined) return
    e.preventDefault()
    e.stopPropagation()
    closeAllContextMenus()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  return (
    <>
      <div
        {...dragProps}
        className={`repo-header${dragOver ? ' repo-header--dnd-over' : ''}`}
        style={group.color ? { ['--ws-color' as string]: group.color } : undefined}
        onClick={onToggleCollapse}
        onContextMenu={handleContextMenu}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggleCollapse()
          }
        }}
      >
        <span className="repo-header__chevron" aria-hidden="true">
          {collapsed ? <ChevronRight /> : <ChevronDown />}
        </span>
        {group.color && <span className="repo-header__swatch" aria-hidden="true" />}
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

        <span className="repo-header__hover">
          {workspaceTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`repo-header__action${tab.id === activeWorkspaceTabId ? ' repo-header__action--on' : ''}`}
              aria-label={tab.label}
              title={tab.label}
              onClick={(e) => {
                e.stopPropagation()
                onSelectWorkspaceTab?.(tab.id)
              }}
            >
              {tab.icon ?? tab.label[0]}
            </button>
          ))}
          {onAddBranch && (
            <button
              type="button"
              className="repo-header__action"
              aria-label={`New branch in ${group.label}`}
              title="New branch"
              onClick={(e) => {
                e.stopPropagation()
                onAddBranch()
              }}
            >
              <Plus aria-hidden="true" />
            </button>
          )}
        </span>

        {/* Last on the row: every count in the sidebar lands in one column,
            and revealing the actions to its left cannot move it. */}
        <span className="repo-header__count">{group.branchCount}</span>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onDismiss={() => setMenu(null)}
          items={[
            ...(onOpenInEditor
              ? [
                  {
                    label: editorName ? `Open in ${editorName}` : 'Open in editor',
                    onSelect: () => {
                      setMenu(null)
                      onOpenInEditor()
                    },
                  },
                ]
              : []),
            ...(onEdit
              ? [{ label: 'Edit workspace', separatorBefore: true, onSelect: onEdit }]
              : []),
            ...(onRemove ? [{ label: 'Remove workspace', danger: true, onSelect: onRemove }] : []),
          ]}
        />
      )}
    </>
  )
}
