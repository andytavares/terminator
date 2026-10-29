import React, { useState } from 'react'
import { ChevronDown, ChevronRight, GitBranch, Plus } from 'lucide-react'
import type { BranchRow as BranchRowData } from '../../sidebar/branch-rows'
import type { DragItemProps } from '../../hooks/useDragReorder'
import type { ChangeStats } from '../../../shared/schemas/git.schema'
import { StateChip } from '../session/StateChip'
import { formatRelativeTime } from '../../sidebar/relative-time'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu'
import { activateOnKey, afterClosing, clickOnly, useRowMenu } from './row-events'
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
  /** Keys its terminals are linked to in their own right, from Home, the wall or the row. */
  sessionIssueKeys?: string[]
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
  /** Puts this branch in a task. */
  onAddToTask?: () => void
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
export function BranchRow(props: BranchRowProps): React.JSX.Element {
  const { row, selected, colour, onSelect, dragProps, dragOver = false } = props
  const { menu, openMenu, closeMenu } = useRowMenu()
  const rename = useRename(row.label, props.onRename)
  const items = branchMenuItems(props, closeMenu, rename.start)

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
        onKeyDown={activateOnKey(onSelect)}
      >
        <BranchRowContent {...props} rename={rename} />
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} onDismiss={closeMenu} items={items} />}
    </>
  )
}

/** Disclosure, state, kind, name (or its editor), key and stats, New terminal, then count or age. */
function BranchRowContent(props: BranchRowProps & { rename: Rename }): React.JSX.Element {
  const { row, rename } = props
  return (
    <>
      <Disclosure {...props} />

      {/* The status gutter: one fixed column, one glyph, never anything else,
          so finding what needs you is a scan down a single column rather than
          a search across full-width rows. */}
      <span className="branch-row__gutter">
        <StateChip state={row.state} compact />
      </span>

      <span className="branch-row__kind">
        {!row.isWorktree && <GitBranch aria-hidden="true" data-kind="branch" />}
      </span>

      {rename.renaming ? (
        <RenameInput rename={rename} />
      ) : (
        <span className="branch-row__name">{row.label}</span>
      )}

      <BranchMeta {...props} />
      {props.onAddTerminal && <AddTerminal label={row.label} onAdd={props.onAddTerminal} />}
      <CountOrAge row={row} now={props.now} />
    </>
  )
}

/** Rename, Open in the editor, the issue actions, the repo's actions, then Remove. Each that
 * does not end the menu itself closes it first. */
function branchMenuItems(
  props: BranchRowProps,
  closeMenu: () => void,
  startRename: () => void
): ContextMenuItem[] {
  const { onRename, onOpenInEditor, onAddToTask, editorName, issueActions } = props
  // Only a branch with no branch to be named by can be renamed: everything
  // else is named by its branch and renaming it would be a lie (ADR-034).
  const items: ContextMenuItem[] = onRename ? [{ label: 'Rename', onSelect: startRename }] : []
  if (onOpenInEditor) {
    items.push({
      label: editorName ? `Open in ${editorName}` : 'Open in editor',
      separatorBefore: onRename !== undefined,
      onSelect: afterClosing(closeMenu, onOpenInEditor),
    })
  }
  if (onAddToTask) {
    items.push({
      label: 'Add to task…',
      separatorBefore: true,
      onSelect: afterClosing(closeMenu, onAddToTask),
    })
  }
  if (issueActions) items.push(...issueMenuItems(issueActions, closeMenu))
  items.push(...repoAndRemoveItems(props, closeMenu))
  return items
}

/** The repo's extension actions, then Remove branch. */
function repoAndRemoveItems(
  { repoActions = [], onRemove }: BranchRowProps,
  closeMenu: () => void
): ContextMenuItem[] {
  const items: ContextMenuItem[] = repoActions.map((action, i) => ({
    label: action.label,
    separatorBefore: i === 0,
    onSelect: afterClosing(closeMenu, action.onSelect),
  }))
  if (onRemove) {
    items.push({ label: 'Remove branch', danger: true, separatorBefore: true, onSelect: onRemove })
  }
  return items
}

/** The in-place rename: the draft, and committing it only when it is a real change. */
function useRename(label: string, onRename: BranchRowProps['onRename']) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(label)

  function commit(): void {
    const next = draft.trim()
    if (next.length > 0 && next !== label) onRename?.(next)
    setRenaming(false)
  }

  function cancel(): void {
    setDraft(label)
    setRenaming(false)
  }

  return { renaming, start: () => setRenaming(true), draft, setDraft, commit, cancel }
}

type Rename = ReturnType<typeof useRename>

/** Enter or leaving commits, Escape abandons; its keys and clicks stay out of the row. */
function RenameInput({ rename }: { rename: Rename }): React.JSX.Element {
  return (
    <input
      className="tmui-inline-edit branch-row__rename"
      value={rename.draft}
      autoFocus
      onChange={(e) => rename.setDraft(e.target.value)}
      onBlur={rename.commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') rename.commit()
        if (e.key === 'Escape') rename.cancel()
      }}
    />
  )
}

/** The disclosure for this branch's terminals. Drawn only when there is something under it, and
 * it takes the click without selecting the branch — expanding to see what is there is not the
 * same act as switching to it. */
function Disclosure({ row, expanded, onToggleExpanded }: BranchRowProps): React.JSX.Element {
  if (!onToggleExpanded || row.terminals.length === 0) {
    return (
      <span className="branch-row__disclosure branch-row__disclosure--empty" aria-hidden="true" />
    )
  }
  return (
    <button
      type="button"
      className="branch-row__disclosure"
      aria-label={expanded ? `Hide terminals in ${row.label}` : `Show terminals in ${row.label}`}
      aria-expanded={expanded}
      onClick={clickOnly(onToggleExpanded)}
    >
      {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
    </button>
  )
}

/** One key element whatever the count: the branch's own key first, then the count of other keys
 * its terminals carry, all of them in the tooltip. */
function issueKeys(issueKey: string | null | undefined, sessionIssueKeys: string[]) {
  const branchKey = issueKey != null && issueKey !== '' ? issueKey : null
  const keys = [...new Set([...(branchKey !== null ? [branchKey] : []), ...sessionIssueKeys])]
  const text = keys.length > 1 ? `${keys[0]} +${keys.length - 1}` : keys[0]
  return { branchKey, keys, text }
}

/** The issue key and the change counts. */
function BranchMeta(props: BranchRowProps): React.JSX.Element {
  const { changeStats } = props
  const hasStats = changeStats != null && (changeStats.added > 0 || changeStats.removed > 0)
  return (
    <span className="branch-row__meta">
      <IssueKey {...props} />
      {hasStats && (
        <span className="branch-row__stats">
          <b>+{changeStats.added}</b> <i>−{changeStats.removed}</i>
        </span>
      )}
    </span>
  )
}

/** The key, as a button when the branch's own key can open the drawer, else plain text. */
function IssueKey({ issueKey, sessionIssueKeys = [], onIssueClick }: BranchRowProps) {
  const { branchKey, keys, text } = issueKeys(issueKey, sessionIssueKeys)
  if (keys.length === 0) return null
  if (branchKey === null || !onIssueClick) {
    return (
      <span className="branch-row__issue" title={keys.join(', ')}>
        {text}
      </span>
    )
  }
  return (
    <button
      type="button"
      className="branch-row__issue"
      aria-label={`Open ${branchKey}`}
      title={keys.join(', ')}
      onClick={clickOnly(onIssueClick)}
    >
      {text}
    </button>
  )
}

function AddTerminal({ label, onAdd }: { label: string; onAdd: () => void }): React.JSX.Element {
  return (
    <span className="branch-row__hover">
      <button
        type="button"
        className="branch-row__action"
        aria-label={`New terminal in ${label}`}
        title="New terminal"
        onClick={clickOnly(onAdd)}
      >
        <Plus aria-hidden="true" />
      </button>
    </span>
  )
}

/** Last on the row, so it sits flush against the right edge and lands in the same column as
 * every other count in the sidebar. Anything that can appear or disappear goes to its left. */
function CountOrAge({ row, now }: Pick<BranchRowProps, 'row' | 'now'>): React.JSX.Element {
  if (row.stateCount > 1) return <span className="branch-row__count">{row.stateCount}</span>
  return (
    <span className="branch-row__age">
      {row.lastActivityAt !== null ? formatRelativeTime(row.lastActivityAt, now) : ''}
    </span>
  )
}
