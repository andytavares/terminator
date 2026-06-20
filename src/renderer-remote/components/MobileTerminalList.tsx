import React, { useEffect, useRef, useState } from 'react'
import type { Workspace, TerminalSession } from '../api/remote-client'

function basename(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? p
}

interface ContextMenuState {
  sessionId: string
  x: number
  y: number
}

interface Props {
  workspaces: Workspace[]
  terminals: TerminalSession[]
  onSelectTerminal: (t: { sessionId: string; cwd: string }) => void
  onCreateTerminal: (workspaceId: string, folderPath: string) => void
  onAssignWorkspace: (sessionId: string, workspaceId: string | null) => void
}

export function MobileTerminalList({
  workspaces,
  terminals,
  onSelectTerminal,
  onCreateTerminal,
  onAssignWorkspace,
}: Props) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    document.addEventListener('touchstart', close, { passive: true })
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('touchstart', close)
    }
  }, [contextMenu])

  const openContextMenu = (sessionId: string, x: number, y: number) => {
    setContextMenu({ sessionId, x, y })
  }

  const handleContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault()
    openContextMenu(sessionId, e.clientX, e.clientY)
  }

  const handleTouchStart = (e: React.TouchEvent, sessionId: string) => {
    longPressFired.current = false
    const touch = e.touches[0]
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      openContextMenu(sessionId, touch.clientX, touch.clientY)
    }, 500)
  }

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const handleTouchMove = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const assignedSessionIds = new Set<string>()

  const TerminalButton = ({
    t,
    showContextMenu = false,
  }: {
    t: TerminalSession
    showContextMenu?: boolean
  }) => (
    <button
      key={t.sessionId}
      className="mobile-list__terminal"
      type="button"
      onClick={() => {
        if (longPressFired.current) return
        onSelectTerminal({ sessionId: t.sessionId, cwd: t.cwd })
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelectTerminal({ sessionId: t.sessionId, cwd: t.cwd })
      }}
      onContextMenu={showContextMenu ? (e) => handleContextMenu(e, t.sessionId) : undefined}
      onTouchStart={showContextMenu ? (e) => handleTouchStart(e, t.sessionId) : undefined}
      onTouchEnd={showContextMenu ? handleTouchEnd : undefined}
      onTouchMove={showContextMenu ? handleTouchMove : undefined}
    >
      <span className="mobile-list__terminal-label">{basename(t.cwd)}</span>
    </button>
  )

  return (
    <div className="mobile-list">
      {workspaces.map((ws) => {
        const wsTerminals = terminals.filter(
          (t) =>
            t.workspaceId === ws.id ||
            (!t.workspaceId && (t.cwd === ws.folderPath || t.cwd.startsWith(ws.folderPath + '/')))
        )
        wsTerminals.forEach((t) => assignedSessionIds.add(t.sessionId))
        return (
          <div key={ws.id} className="mobile-list__workspace">
            <p className="mobile-list__workspace-name">{ws.name}</p>
            {wsTerminals.map((t) => (
              <TerminalButton key={t.sessionId} t={t} />
            ))}
            <button
              className="mobile-list__new-terminal-btn"
              type="button"
              onClick={() => onCreateTerminal(ws.id, ws.folderPath)}
            >
              + New Terminal
            </button>
          </div>
        )
      })}
      {terminals
        .filter((t) => !assignedSessionIds.has(t.sessionId))
        .map((t) => (
          <TerminalButton key={t.sessionId} t={t} showContextMenu />
        ))}
      {contextMenu && (
        <div
          className="mobile-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mobile-context-menu__label">Move to workspace</p>
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              type="button"
              className="mobile-context-menu__item"
              onClick={() => {
                onAssignWorkspace(contextMenu.sessionId, ws.id)
                setContextMenu(null)
              }}
            >
              {ws.name}
            </button>
          ))}
          {workspaces.length === 0 && (
            <span className="mobile-context-menu__empty">No workspaces</span>
          )}
        </div>
      )}
    </div>
  )
}
