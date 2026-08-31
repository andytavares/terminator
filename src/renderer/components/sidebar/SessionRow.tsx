import React, { useRef, useState } from 'react'
import { Circle, CircleX, Pause, Play } from 'lucide-react'
import type { TerminalSession } from '../../../shared/types/index'
import { formatRelativeTime } from '../../sidebar/relative-time'
import { statusPresentationFor, type StatusIcon } from '../../sidebar/session-status'
import { useSessionStore } from '../../stores/session.store'
import { MoveSessionDialog } from './MoveSessionDialog'
import { ContextMenu, closeAllContextMenus } from '../ContextMenu'
import './SessionRow.css'

interface SessionRowProps {
  session: TerminalSession
  isActive: boolean
  isBusy: boolean
  bellCount: number
  /**
   * The session's own workspace colour, or '' when it belongs to none. Set on
   * the row rather than inherited from the group, because a group keyed by
   * status or branch spans workspaces and has no colour to hand down.
   */
  workspaceColor: string
  onSelect: () => void
  onRename: (newTitle: string) => void
  isSubSession?: boolean
  hidden?: boolean
  /** Epoch ms used for the relative activity label; omitted hides the label. */
  now?: number
  /** Project name shown as a badge when the grouping does not already say it. */
  projectBadge?: string
  /** Opens the scope menu for this row's project (D3). */
  onScopeClick?: (e: React.MouseEvent) => void
  /** True in the Stale view, where rows can be multi-selected for bulk close. */
  selectable?: boolean
  selected?: boolean
  onToggleSelected?: (shiftKey: boolean) => void
  /** Commits the row's one-line note. */
  onSetNote?: (note: string) => void
  /** Opens the note editor from outside, e.g. the Cmd+I shortcut. */
  noteEditing?: boolean
  onNoteEditingChange?: (editing: boolean) => void
}

const STATUS_ICON: Record<StatusIcon, typeof Circle> = {
  play: Play,
  circle: Circle,
  pause: Pause,
  'circle-x': CircleX,
}

export function SessionRow({
  session,
  isActive,
  isBusy,
  bellCount,
  workspaceColor,
  onSelect,
  onRename,
  isSubSession,
  hidden,
  now,
  projectBadge,
  onScopeClick,
  selectable,
  selected,
  onToggleSelected,
  onSetNote,
  noteEditing,
  onNoteEditingChange,
}: SessionRowProps): JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const renameRef = useRef<HTMLInputElement>(null)

  if (hidden) return <></>

  function startRename(): void {
    setRenameValue(session.tabTitle)
    setRenaming(true)
    setTimeout(() => renameRef.current?.select(), 0)
  }

  function commitRename(): void {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== session.tabTitle) onRename(trimmed)
    setRenaming(false)
  }

  function handleRenameKey(e: React.KeyboardEvent): void {
    if (e.key === 'Enter') commitRename()
    if (e.key === 'Escape') setRenaming(false)
  }

  function handleContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    closeAllContextMenus()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  const status = statusPresentationFor(session)

  function renderStatus(): React.ReactNode {
    // A live spinner outranks everything: it is the only signal about right now.
    if (isBusy) return <span className="session-row__spinner" />

    // Shape carries the state; the icon inherits currentColor and is hidden
    // from assistive technology, which reads the row's aria-label instead.
    const Icon = STATUS_ICON[status.icon]
    const glyph = <Icon aria-hidden="true" data-state={session.agentState} />

    // A waiting session shows its glyph *and* how many times it asked. Letting
    // the count replace the glyph made the waiting shape unreachable, since the
    // count is the very thing the waiting state is derived from.
    if (bellCount > 0) {
      return (
        <span className="session-row__waiting">
          {glyph}
          <span className="session-row__bell">
            <span>{bellCount}</span>
          </span>
        </span>
      )
    }
    return glyph
  }

  const needsYou = status.emphasises

  function commitNote(value: string): void {
    onSetNote?.(value)
    onNoteEditingChange?.(false)
  }

  return (
    <>
      <div
        className={`session-row${isActive ? ' session-row--active' : ''}${isSubSession ? ' session-row--sub' : ''}${needsYou ? ' session-row--needs-you' : ''}`}
        style={
          workspaceColor
            ? ({ ['--ws-color' as string]: workspaceColor } as React.CSSProperties)
            : undefined
        }
        onClick={onSelect}
        onDoubleClick={startRename}
        onContextMenu={handleContextMenu}
        aria-label={`${session.tabTitle}, ${status.label}${
          now === undefined ? '' : `, active ${formatRelativeTime(session.lastActivityAt, now)}`
        }`}
      >
        {selectable && (
          <input
            type="checkbox"
            className="session-row__select"
            aria-label={`Select ${session.tabTitle}`}
            checked={selected ?? false}
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelected?.(e.shiftKey)
            }}
            onChange={() => {}}
          />
        )}
        <span className="session-row__status">{renderStatus()}</span>
        {renaming ? (
          <input
            ref={renameRef}
            className="session-row__rename-input"
            value={renameValue}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleRenameKey}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="session-row__title" title={session.tabTitle}>
            {session.tabTitle}
          </span>
        )}
        {noteEditing ? (
          <input
            className="session-row__note-input"
            defaultValue={session.note ?? ''}
            placeholder="note"
            autoFocus
            maxLength={120}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => commitNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitNote((e.target as HTMLInputElement).value)
              if (e.key === 'Escape') onNoteEditingChange?.(false)
              e.stopPropagation()
            }}
          />
        ) : (
          session.note && (
            <span className="session-row__note" title={session.note}>
              {session.note}
            </span>
          )
        )}
        {needsYou && !projectBadge && (
          <span className="session-row__needs-you-pill">needs you</span>
        )}
        {projectBadge && (
          <button
            className="session-row__project-badge"
            title={`Actions for ${projectBadge}`}
            onClick={(e) => {
              e.stopPropagation()
              onScopeClick?.(e)
            }}
          >
            {projectBadge}
          </button>
        )}
        {now !== undefined && !needsYou && (
          <span className="session-row__activity">
            {formatRelativeTime(session.lastActivityAt, now)}
          </span>
        )}
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onDismiss={() => setCtxMenu(null)}
          items={[
            {
              label: 'Rename',
              onSelect: () => {
                setCtxMenu(null)
                startRename()
              },
            },
            {
              label: 'Move to branch',
              onSelect: () => {
                setCtxMenu(null)
                setMoveOpen(true)
              },
            },
            {
              label: 'Close',
              danger: true,
              separatorBefore: true,
              onSelect: () => {
                setCtxMenu(null)
                void useSessionStore.getState().closeSession(session.id)
              },
            },
          ]}
        />
      )}

      {moveOpen && <MoveSessionDialog sessionId={session.id} onClose={() => setMoveOpen(false)} />}
    </>
  )
}
