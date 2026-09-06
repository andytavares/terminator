import React, { useState } from 'react'
import { ChevronDown, ChevronRight, GitBranch, Plus } from 'lucide-react'
import type { BranchRow as BranchRowData } from '../../sidebar/branch-rows'
import type { DragItemProps } from '../../hooks/useDragReorder'
import type { ChangeStats } from '../../../shared/schemas/git.schema'
import { ICON_FOR_STATE, STATUS_ICON } from '../../sidebar/state-icons'
import { formatRelativeTime } from '../../sidebar/relative-time'
import { ContextMenu, closeAllContextMenus, type ContextMenuItem } from '../ContextMenu'
import { issueMenuItems, type IssueMenuActions } from './issue-menu-items'
import './BranchRow.css'

const STATE_LABEL: Record<BranchRowData['state'], string> = {
  'awaiting-input': 'Waiting on you',
  working: 'Running',
  idle: 'Idle',
  exited: 'Exited',
}

export interface BranchRowProps {
  row: BranchRowData
  selected: boolean
  colour?: string
  now: number
  /** The tracker key attached to this branch, drawn as plain text. */
  issueKey?: string | null
  /** Opens the issue drawer. The key lost its badge, not its behaviour. */
  onIssueClick?: () => void
  /**
   * Uncommitted change volume. `undefined` means not asked for yet and `null`
   * means git could not answer — both draw nothing, because change volume is
   * decorative and a git failure must not produce a broken-looking row.
   */
  changeStats?: ChangeStats | null
  onSelect: () => void
  /**
   * Whether the terminals under this branch are listed.
   *
   * Absent when the row has none — the chevron is drawn only where there is
   * something behind it, so an empty branch does not offer a disclosure that
   * reveals nothing.
   */
  expanded?: boolean
  onToggleExpanded?: () => void
  onAddTerminal?: () => void
  onRename?: (name: string) => void
  onRemove?: () => void
  /** Opens this branch's working copy in the user's editor. */
  onOpenInEditor?: () => void
  /** Names the editor in the menu — "Open in Cursor" beats "Open in editor". */
  editorName?: string
  issueActions?: IssueMenuActions
  /**
   * Repo-scoped extension actions, reachable from the row's own menu.
   *
   * They live on the repo header, but under "no grouping" there is no repo
   * header to host them — and a contributed surface must be reachable in every
   * grouping (EA-2). This is the same escape the old ScopeMenu provided.
   */
  repoActions?: Array<{ id: string; label: string; onSelect: () => void }>
  /**
   * Drag-to-reorder within the repo. Absent under "no grouping", where the one
   * list spans every repo and the stores keep no order that crosses them.
   */
  dragProps?: DragItemProps
  dragOver?: boolean
}

/**
 * One branch.
 *
 * At most six things at rest, and each is there because it differs from some
 * other row: the state glyph, the kind glyph, the name, the issue key, the
 * change counts, and either a count or an age. The repo's colour rail is not
 * among them — it is identity rather than a fact (FR-026).
 *
 * The kind glyph marks a **plain checkout**, not a worktree. Terminator makes a
 * worktree per branch, so the worktree is the norm and marking it would put a
 * glyph on nearly every row saying nothing; marking the exception is the same
 * information for a fraction of the ink.
 *
 * The count is paired with the glyph: a row showing the waiting shape counts
 * what is waiting, not how many terminals it has. "Two waiting" answers the
 * question the row exists for; "three terminals" does not.
 */
export function BranchRow({
  row,
  selected,
  colour,
  now,
  issueKey,
  onIssueClick,
  changeStats,
  onSelect,
  expanded,
  onToggleExpanded,
  onAddTerminal,
  onRename,
  onRemove,
  onOpenInEditor,
  editorName,
  issueActions,
  repoActions = [],
  dragProps,
  dragOver = false,
}: BranchRowProps): JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(row.label)

  const Glyph = STATUS_ICON[ICON_FOR_STATE[row.state]]
  const hasStats = changeStats != null && (changeStats.added > 0 || changeStats.removed > 0)

  function openMenu(e: React.MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    closeAllContextMenus()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  function commitRename(): void {
    const next = draft.trim()
    if (next.length > 0 && next !== row.label) onRename?.(next)
    setRenaming(false)
  }

  const items: ContextMenuItem[] = [
    // Only a branch with no branch to be named by can be renamed: everything
    // else is named by its branch and renaming it would be a lie (ADR-034).
    ...(onRename ? [{ label: 'Rename', onSelect: () => setRenaming(true) }] : []),
    ...(onOpenInEditor
      ? [
          {
            label: editorName ? `Open in ${editorName}` : 'Open in editor',
            separatorBefore: onRename !== undefined,
            onSelect: () => {
              setMenu(null)
              onOpenInEditor()
            },
          },
        ]
      : []),
    ...(issueActions ? issueMenuItems(issueActions, () => setMenu(null)) : []),
    ...repoActions.map((action, i) => ({
      label: action.label,
      separatorBefore: i === 0,
      onSelect: () => {
        setMenu(null)
        action.onSelect()
      },
    })),
    ...(onRemove
      ? [{ label: 'Remove branch', danger: true, separatorBefore: true, onSelect: onRemove }]
      : []),
  ]

  return (
    <>
      <div
        {...dragProps}
        className={`branch-row${selected ? ' branch-row--selected' : ''}${dragOver ? ' branch-row--dnd-over' : ''}`}
        style={colour ? { ['--ws-color' as string]: colour } : undefined}
        onClick={onSelect}
        onContextMenu={items.length > 0 ? openMenu : undefined}
        role="button"
        tabIndex={0}
        aria-current={selected ? 'true' : undefined}
        aria-label={`${row.label} — ${STATE_LABEL[row.state]}`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect()
          }
        }}
      >
        {/* The disclosure for this branch's terminals. Drawn only when there
            is something under it, and it takes the click without selecting the
            branch — expanding to see what is there is not the same act as
            switching to it. */}
        {onToggleExpanded && row.terminals.length > 0 ? (
          <button
            type="button"
            className="branch-row__disclosure"
            aria-label={
              expanded ? `Hide terminals in ${row.label}` : `Show terminals in ${row.label}`
            }
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpanded()
            }}
          >
            {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </button>
        ) : (
          <span
            className="branch-row__disclosure branch-row__disclosure--empty"
            aria-hidden="true"
          />
        )}

        {/* The status gutter: one fixed column, one glyph, never anything else,
            so finding what needs you is a scan down a single column rather than
            a search across full-width rows. */}
        <span className={`branch-row__gutter branch-row__state--${row.state}`}>
          <Glyph aria-hidden="true" data-state={row.state} />
        </span>

        <span className="branch-row__kind">
          {!row.isWorktree && <GitBranch aria-hidden="true" data-kind="branch" />}
        </span>

        {renaming ? (
          <input
            className="branch-row__rename"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') {
                setDraft(row.label)
                setRenaming(false)
              }
            }}
          />
        ) : (
          <span className="branch-row__name">{row.label}</span>
        )}

        <span className="branch-row__meta">
          {issueKey != null &&
            issueKey !== '' &&
            (onIssueClick ? (
              <button
                type="button"
                className="branch-row__issue"
                aria-label={`Open ${issueKey}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onIssueClick()
                }}
              >
                {issueKey}
              </button>
            ) : (
              <span className="branch-row__issue">{issueKey}</span>
            ))}
          {hasStats && (
            <span className="branch-row__stats">
              <b>+{changeStats!.added}</b> <i>−{changeStats!.removed}</i>
            </span>
          )}
        </span>

        {onAddTerminal && (
          <span className="branch-row__hover">
            <button
              type="button"
              className="branch-row__action"
              aria-label={`New terminal in ${row.label}`}
              title="New terminal"
              onClick={(e) => {
                e.stopPropagation()
                onAddTerminal()
              }}
            >
              <Plus aria-hidden="true" />
            </button>
          </span>
        )}

        {/* Last on the row, so it sits flush against the right edge and lands
            in the same column as every other count in the sidebar. Anything
            that can appear or disappear goes to its left. */}
        {row.stateCount > 1 ? (
          <span className="branch-row__count">{row.stateCount}</span>
        ) : (
          <span className="branch-row__age">
            {row.lastActivityAt !== null ? formatRelativeTime(row.lastActivityAt, now) : ''}
          </span>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} onDismiss={() => setMenu(null)} items={items} />}
    </>
  )
}
