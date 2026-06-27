import React, { useEffect, useRef, useState } from 'react'
import type { TerminalSession } from '../../../shared/types/index'
import { useSessionStore } from '../../stores/session.store'
import { MoveSessionDialog } from './MoveSessionDialog'
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

  useEffect(() => {
    function closeHandler() {
      setCtxMenu(null)
    }
    window.addEventListener('close-context-menus', closeHandler)
    return () => window.removeEventListener('close-context-menus', closeHandler)
  }, [])

  function handleContextMenu(e: React.MouseEvent, sessionId: string): void {
    e.preventDefault()
    window.dispatchEvent(new CustomEvent('close-context-menus'))
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
        <ScratchCtxMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          sessionId={ctxMenu.sessionId}
          sessions={sessions}
          onRename={() => {
            const session = sessions.find((s) => s.id === ctxMenu.sessionId)
            if (session) startRename(session)
            setCtxMenu(null)
          }}
          onMove={() => {
            setMoveSessionId(ctxMenu.sessionId)
            setCtxMenu(null)
          }}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {moveSessionId && (
        <MoveSessionDialog sessionId={moveSessionId} onClose={() => setMoveSessionId(null)} />
      )}
    </div>
  )
}

function ScratchCtxMenu({
  x,
  y,
  onRename,
  onMove,
  onClose,
}: {
  x: number
  y: number
  sessionId: string
  sessions: TerminalSession[]
  onRename: () => void
  onMove: () => void
  onClose: () => void
}): JSX.Element {
  useEffect(() => {
    const close = (): void => onClose()
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [onClose])

  return (
    <div className="ctx-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      <button className="ctx-menu__item" onClick={onRename}>
        Rename
      </button>
      <button className="ctx-menu__item" onClick={onMove}>
        Move to project…
      </button>
    </div>
  )
}
