import React, { useRef, useState } from 'react'
import { Bot, Terminal } from 'lucide-react'
import type { TerminalSession } from '../../../shared/types/index'
import { formatRelativeTime } from '../../sidebar/relative-time'
import { useSessionStore } from '../../stores/session.store'
import { MoveSessionDialog } from './MoveSessionDialog'
import { ContextMenu, closeAllContextMenus } from '../ContextMenu'
import './SessionRow.css'

interface SessionRowProps {
  session: TerminalSession
  isActive: boolean
  isBusy: boolean
  bellCount: number
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
}

export function SessionRow({
  session,
  isActive,
  isBusy,
  bellCount,
  onSelect,
  onRename,
  isSubSession,
  hidden,
  now,
  projectBadge,
  onScopeClick,
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

  const PrefixIcon = session.type === 'agent' ? Bot : Terminal

  function renderStatus(): React.ReactNode {
    if (isBusy) return <span className="session-row__spinner" />
    if (bellCount > 0) {
      return (
        <span className="session-row__bell">
          <span>{bellCount}</span>
        </span>
      )
    }
    // One dot shape at three opacities. Hue never carries meaning on its own —
    // awaiting-input is marked by the edge bar and pill below, not by colour.
    if (session.agentState === 'exited')
      return <span className="session-row__dot session-row__dot--exited" />
    if (isActive) return <span className="session-row__dot session-row__dot--active" />
    return <span className="session-row__dot session-row__dot--dim" />
  }

  const needsYou = session.agentState === 'awaiting-input'

  return (
    <>
      <div
        className={`session-row${isActive ? ' session-row--active' : ''}${isSubSession ? ' session-row--sub' : ''}${needsYou ? ' session-row--needs-you' : ''}`}
        onClick={onSelect}
        onDoubleClick={startRename}
        onContextMenu={handleContextMenu}
      >
        <span className="session-row__prefix">
          <PrefixIcon size={11} />
        </span>
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
        {needsYou && <span className="session-row__needs-you-pill">needs you</span>}
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
        {now !== undefined && (
          <span className="session-row__activity">
            {formatRelativeTime(session.lastActivityAt, now)}
          </span>
        )}
        <span className="session-row__status">{renderStatus()}</span>
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
              label: 'Move to project',
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
