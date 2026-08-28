import React, { useRef, useState } from 'react'
import type { TerminalSession } from '../../../shared/types/index'
import { useSessionStore } from '../../stores/session.store'
import { MoveSessionDialog } from './MoveSessionDialog'
import { ContextMenu, closeAllContextMenus } from '../ContextMenu'
import './ScratchSection.css'

interface ScratchSectionProps {
  sessions: TerminalSession[]
  activeSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onNewScratch: () => void
}

export function ScratchSection({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewScratch,
}: ScratchSectionProps): JSX.Element {
  const { renameSession } = useSessionStore()
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)
  const [moveSessionId, setMoveSessionId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameRef = useRef<HTMLInputElement>(null)

  function handleContextMenu(e: React.MouseEvent, sessionId: string): void {
    e.preventDefault()
    closeAllContextMenus()
    setCtxMenu({ x: e.clientX, y: e.clientY, sessionId })
  }

  function startRename(session: TerminalSession): void {
    setRenamingId(session.id)
    setRenameValue(session.tabTitle)
    setTimeout(() => renameRef.current?.select(), 0)
  }

  function commitRename(sessionId: string): void {
    const trimmed = renameValue.trim()
    if (trimmed) renameSession(sessionId, trimmed)
    setRenamingId(null)
  }

  return (
    <div className="scratch-section">
      <div className="scratch-section__label">Scratch</div>
      {sessions.map((session) => (
        <div
          key={session.id}
          className={`scratch-section__row${activeSessionId === session.id ? ' scratch-section__row--active' : ''}`}
          onClick={() => onSelectSession(session.id)}
          onDoubleClick={() => startRename(session)}
          onContextMenu={(e) => handleContextMenu(e, session.id)}
        >
          <span className="scratch-section__row-prefix">~</span>
          {renamingId === session.id ? (
            <input
              ref={renameRef}
              className="scratch-section__rename-input"
              value={renameValue}
              autoFocus
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => commitRename(session.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(session.id)
                if (e.key === 'Escape') setRenamingId(null)
                e.stopPropagation()
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="scratch-section__row-title">{session.tabTitle}</span>
          )}
        </div>
      ))}
      <button className="scratch-section__add" onClick={onNewScratch}>
        <span>+</span>
        <span>New scratch terminal</span>
      </button>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onDismiss={() => setCtxMenu(null)}
          items={[
            {
              label: 'Rename',
              onSelect: () => {
                const session = sessions.find((s) => s.id === ctxMenu.sessionId)
                if (session) startRename(session)
                setCtxMenu(null)
              },
            },
            {
              label: 'Move to branch…',
              onSelect: () => {
                setMoveSessionId(ctxMenu.sessionId)
                setCtxMenu(null)
              },
            },
          ]}
        />
      )}

      {moveSessionId && (
        <MoveSessionDialog sessionId={moveSessionId} onClose={() => setMoveSessionId(null)} />
      )}
    </div>
  )
}
