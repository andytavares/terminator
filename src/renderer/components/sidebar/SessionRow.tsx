import React, { useRef, useState } from 'react'
import { Bot, Terminal } from 'lucide-react'
import type { TerminalSession } from '../../../shared/types/index'
import { useSessionStore } from '../../stores/session.store'
import { MoveSessionDialog } from './MoveSessionDialog'
import './SessionRow.css'

interface SessionRowProps {
  session: TerminalSession
  isActive: boolean
  isBusy: boolean
  bellCount: number
  workspaceColor: string
  onSelect: () => void
  onRename: (newTitle: string) => void
  hidden?: boolean
}

export function SessionRow({
  session,
  isActive,
  isBusy,
  bellCount,
  onSelect,
  onRename,
  hidden,
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
    if (isActive) return <span className="session-row__dot session-row__dot--active" />
    return <span className="session-row__dot session-row__dot--dim" />
  }

  return (
    <>
      <div
        className={`session-row${isActive ? ' session-row--active' : ''}`}
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
        <span className="session-row__status">{renderStatus()}</span>
      </div>

      {ctxMenu && (
        <SessionRowCtxMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onRename={() => {
            setCtxMenu(null)
            startRename()
          }}
          onMove={() => {
            setCtxMenu(null)
            setMoveOpen(true)
          }}
          onClose={() => {
            setCtxMenu(null)
            void useSessionStore.getState().closeSession(session.id)
          }}
          onMenuClose={() => setCtxMenu(null)}
        />
      )}

      {moveOpen && <MoveSessionDialog sessionId={session.id} onClose={() => setMoveOpen(false)} />}
    </>
  )
}

function SessionRowCtxMenu({
  x,
  y,
  onRename,
  onMove,
  onClose,
  onMenuClose,
}: {
  x: number
  y: number
  onRename: () => void
  onMove: () => void
  onClose: () => void
  onMenuClose: () => void
}): JSX.Element {
  React.useEffect(() => {
    const close = (): void => onMenuClose()
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [onMenuClose])

  return (
    <div className="ctx-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      <button className="ctx-menu__item" onClick={onRename}>
        Rename
      </button>
      <button className="ctx-menu__item" onClick={onMove}>
        Move to project
      </button>
      <div className="ctx-menu__separator" />
      <button className="ctx-menu__item ctx-menu__item--danger" onClick={onClose}>
        Close
      </button>
    </div>
  )
}
