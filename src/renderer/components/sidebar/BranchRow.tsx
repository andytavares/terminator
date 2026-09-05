import React, { useState } from 'react'
import { Circle, CircleX, GitBranch, Pause, Play, Plus } from 'lucide-react'
import type { BranchRow as BranchRowData } from '../../sidebar/branch-rows'
import type { ChangeStats } from '../../../shared/schemas/git.schema'
import type { StatusIcon } from '../../sidebar/session-status'
import { formatRelativeTime } from '../../sidebar/relative-time'
import { ContextMenu, closeAllContextMenus, type ContextMenuItem } from '../ContextMenu'
import { issueMenuItems, type IssueMenuActions } from './issue-menu-items'
import './BranchRow.css'

/** The same four shapes the terminal tabs and the board lanes use. */
const STATUS_ICON: Record<StatusIcon, typeof Circle> = {
  play: Play,
  circle: Circle,
  pause: Pause,
  'circle-x': CircleX,
}

const ICON_FOR_STATE: Record<BranchRowData['state'], StatusIcon> = {
  'awaiting-input': 'pause',
  working: 'play',
  idle: 'circle',
  exited: 'circle-x',
}

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
  onAddTerminal,
  onRename,
  onRemove,
  onOpenInEditor,
  editorName,
  issueActions,
  repoActions = [],
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
        className={`branch-row${selected ? ' branch-row--selected' : ''}`}
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
          {row.stateCount > 1 ? (
            <span className="branch-row__count">{row.stateCount}</span>
          ) : (
            row.lastActivityAt !== null && (
              <span className="branch-row__age">{formatRelativeTime(row.lastActivityAt, now)}</span>
            )
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
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} onDismiss={() => setMenu(null)} items={items} />}
    </>
  )
}
