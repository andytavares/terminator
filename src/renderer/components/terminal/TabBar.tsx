import React, { useState, useRef } from 'react'
import { Play, Circle, Pause, CircleX } from 'lucide-react'
import { useSessionStore } from '../../stores/session.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { AlertBadge } from '../AlertBadge'
import { MoveSessionDialog } from '../sidebar/MoveSessionDialog'
import type { ProjectTabRegistration } from '../../extensions/registry'
import { qualifiedBranchLabel } from '../../sidebar/branch-display'
import { statusPresentationFor, type StatusIcon } from '../../sidebar/session-status'
import './TabBar.css'

/**
 * Past this many terminals the row scrolls, and it says so. Overflow being
 * invisible is a defect this feature would otherwise make worse by adding a
 * glyph to every tab (docs/ux-improvement-prd.md 3.4).
 */
const SCROLL_AFTER = 8

/** Same four shapes the sidebar gutter and the board lanes use. */
const STATUS_ICON: Record<StatusIcon, typeof Circle> = {
  play: Play,
  circle: Circle,
  pause: Pause,
  'circle-x': CircleX,
}

interface Props {
  projectId: string
  /**
   * Opens the note editor on this terminal. The note used to be edited on the
   * sidebar row; with the rows gone the tab is where the note lives, so the
   * ⌘I shortcut points here instead (FR-023).
   */
  editNoteSessionId?: string | null
  activeProjectTabId: string | null
  projectTabs: ProjectTabRegistration[]
  onSelectProjectTab: (tabId: string | null) => void
  onNewTab: () => void
  onScratchDeactivate?: () => void
}

export function TabBar({
  projectId,
  editNoteSessionId,
  activeProjectTabId,
  projectTabs,
  onSelectProjectTab,
  onNewTab,
  onScratchDeactivate,
}: Props): JSX.Element {
  const {
    getSessionsForProject,
    closeSession,
    setActiveSessionForProject,
    getActiveSessionForProject,
    getBellCountForSession,
    renameSession,
    reorderSessions,
    setSessionNote,
  } = useSessionStore()
  const [notingId, setNotingId] = useState<string | null>(null)
  const [noteValue, setNoteValue] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)
  const [moveDialogSessionId, setMoveDialogSessionId] = useState<string | null>(null)
  const dragIndexRef = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const { workspaces, activeWorkspaceId, projectsByWorkspaceId } = useWorkspaceStore()
  const branch = [...projectsByWorkspaceId.values()].flat().find((p) => p.id === projectId)
  const scopeLabel = branch
    ? qualifiedBranchLabel(branch, workspaces.find((w) => w.id === branch.workspaceId)?.name)
    : null
  const allSessions = getSessionsForProject(projectId)
  const sessions = allSessions.filter((s) => !s.parentSessionId)
  const activeSessionId = getActiveSessionForProject(projectId)
  const activeSession = allSessions.find((s) => s.id === activeSessionId)
  const effectiveActiveId = activeSession?.parentSessionId ?? activeSessionId
  const wsColor = workspaces.find((w) => w.id === activeWorkspaceId)?.color
  const isTerminalActive = activeProjectTabId === null

  function handleCloseSession(e: React.MouseEvent, sessionId: string): void {
    e.stopPropagation()
    void closeSession(sessionId)
  }

  function handleSessionTabClick(sessionId: string): void {
    setActiveSessionForProject(projectId, sessionId)
  }

  function startRename(e: React.MouseEvent, sessionId: string, currentTitle: string): void {
    e.stopPropagation()
    setRenamingId(sessionId)
    setRenameValue(currentTitle)
  }

  function commitRename(sessionId: string): void {
    const trimmed = renameValue.trim()
    if (trimmed) renameSession(sessionId, trimmed)
    setRenamingId(null)
  }

  function cancelRename(): void {
    setRenamingId(null)
  }

  function handleSessionContextMenu(e: React.MouseEvent, sessionId: string): void {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, sessionId })
  }

  // Drag-and-drop handlers for tab reordering
  function handleTabDragStart(index: number): void {
    dragIndexRef.current = index
  }

  function handleTabDragOver(e: React.DragEvent, index: number): void {
    e.preventDefault()
    setDragOverIndex(index)
  }

  React.useEffect(() => {
    if (!editNoteSessionId) return
    const target = allSessions.find((s) => s.id === editNoteSessionId)
    if (target === undefined) return
    setNotingId(editNoteSessionId)
    setNoteValue(target.note ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editNoteSessionId])

  function commitNote(sessionId: string): void {
    setSessionNote(sessionId, noteValue.trim())
    setNotingId(null)
  }

  function handleTabDrop(dropIndex: number): void {
    const fromIndex = dragIndexRef.current
    if (fromIndex === null || fromIndex === dropIndex) {
      setDragOverIndex(null)
      dragIndexRef.current = null
      return
    }
    const reordered = [...sessions]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(dropIndex, 0, moved)
    reorderSessions(
      projectId,
      reordered.map((s) => s.id)
    )
    dragIndexRef.current = null
    setDragOverIndex(null)
  }

  return (
    <div
      className="tab-bar-stack"
      style={wsColor ? { ['--ws-color' as string]: wsColor } : undefined}
    >
      {/* Primary tab bar: Terminal + extension-contributed tabs */}
      <div className="tab-bar tab-bar--primary">
        <div
          className={`tab-bar__tab${isTerminalActive ? ' tab-bar__tab--active' : ''}`}
          onClick={() => onSelectProjectTab(null)}
        >
          <span className="tab-bar__title">Terminal</span>
        </div>

        {projectTabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab-bar__tab${tab.id === activeProjectTabId ? ' tab-bar__tab--active' : ''}`}
            onClick={() => onSelectProjectTab(tab.id)}
          >
            <span className="tab-bar__title">{tab.label}</span>
          </div>
        ))}
      </div>

      {/* Session sub-tab bar: only visible when Terminal is the active primary tab */}
      {isTerminalActive && (
        <div
          className={`tab-bar tab-bar--sessions${sessions.length > SCROLL_AFTER ? ' tab-bar--scrollable' : ''}`}
        >
          {/* Tabs are scoped to one branch, and switching branches silently
              swapped the whole row. Say whose terminals these are. */}
          {scopeLabel && (
            <span className="tab-bar__scope" title={scopeLabel}>
              {scopeLabel}
            </span>
          )}
          {sessions.map((session, index) => (
            <div
              key={session.id}
              draggable
              onDragStart={() => handleTabDragStart(index)}
              onDragOver={(e) => handleTabDragOver(e, index)}
              onDragLeave={() => setDragOverIndex(null)}
              onDrop={() => handleTabDrop(index)}
              onDragEnd={() => {
                dragIndexRef.current = null
                setDragOverIndex(null)
              }}
              className={`tab-bar__tab tab-bar__tab--session${session.id === effectiveActiveId ? ' tab-bar__tab--active' : ''}${dragOverIndex === index ? ' tab-bar__tab--dnd-over' : ''}`}
              onClick={() => handleSessionTabClick(session.id)}
              onContextMenu={(e) => handleSessionContextMenu(e, session.id)}
              onDoubleClick={(e) => startRename(e, session.id, session.tabTitle)}
              /* The note lives here and is drawn nowhere: re-homing it from the
                 sidebar row must not put a fifth thing on a 100px tab. The
                 rename affordance sits on the same element, so the tooltip
                 describes what double-clicking the tab actually does. */
              title={session.note ?? 'Double-click to rename'}
            >
              {renamingId !== session.id &&
                (() => {
                  const status = statusPresentationFor(session)
                  const Icon = STATUS_ICON[status.icon]
                  return (
                    <span className="tab-bar__state" aria-label={status.label}>
                      <Icon aria-hidden="true" data-state={session.agentState} />
                    </span>
                  )
                })()}
              {notingId === session.id ? (
                <input
                  className="tab-bar__note-input"
                  value={noteValue}
                  maxLength={120}
                  placeholder="note"
                  autoFocus
                  onChange={(e) => setNoteValue(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') commitNote(session.id)
                    if (e.key === 'Escape') setNotingId(null)
                  }}
                  onBlur={() => commitNote(session.id)}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : renamingId === session.id ? (
                <input
                  className="tab-bar__rename-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(session.id)
                    if (e.key === 'Escape') cancelRename()
                    e.stopPropagation()
                  }}
                  onBlur={() => commitRename(session.id)}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <span className="tab-bar__title">{session.tabTitle}</span>
              )}
              {session.id !== effectiveActiveId && renamingId !== session.id && (
                <AlertBadge
                  count={getBellCountForSession(session.id)}
                  className="alert-badge--tab"
                />
              )}
              {/* Close only on the tab you are on. A close button on every tab
                  was the fourth element on a 100px box, and closing a terminal
                  you are not looking at is not a thing worth one-clicking. */}
              {session.id === effectiveActiveId && renamingId !== session.id && (
                <button
                  className="tab-bar__close"
                  onClick={(e) => handleCloseSession(e, session.id)}
                  title="Close tab"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button className="tab-bar__new-tab" onClick={onNewTab} title="New tab (⌘T)">
            +
          </button>
        </div>
      )}

      {ctxMenu && (
        <SessionTabCtxMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          sessionId={ctxMenu.sessionId}
          currentTitle={sessions.find((s) => s.id === ctxMenu.sessionId)?.tabTitle ?? ''}
          currentNote={sessions.find((s) => s.id === ctxMenu.sessionId)?.note ?? ''}
          onRename={(id, title) => {
            setCtxMenu(null)
            setRenamingId(id)
            setRenameValue(title)
          }}
          onMove={(id) => {
            setCtxMenu(null)
            setMoveDialogSessionId(id)
          }}
          onNote={(id, note) => {
            setCtxMenu(null)
            setNotingId(id)
            setNoteValue(note)
          }}
          onClose={() => setCtxMenu(null)}
          onCloseTab={(id) => {
            setCtxMenu(null)
            void closeSession(id)
          }}
        />
      )}

      {moveDialogSessionId && (
        <MoveSessionDialog
          sessionId={moveDialogSessionId}
          onClose={() => setMoveDialogSessionId(null)}
          onMoved={() => {
            setMoveDialogSessionId(null)
            onScratchDeactivate?.()
          }}
        />
      )}
    </div>
  )
}

function SessionTabCtxMenu({
  x,
  y,
  sessionId,
  currentTitle,
  currentNote,
  onRename,
  onMove,
  onNote,
  onClose,
  onCloseTab,
}: {
  x: number
  y: number
  sessionId: string
  currentTitle: string
  currentNote: string
  onRename: (id: string, title: string) => void
  onMove: (id: string) => void
  onNote: (id: string, note: string) => void
  onClose: () => void
  onCloseTab: (id: string) => void
}): JSX.Element {
  React.useEffect(() => {
    const close = (): void => onClose()
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [onClose])

  return (
    <div className="ctx-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      <button className="ctx-menu__item" onClick={() => onRename(sessionId, currentTitle)}>
        Rename
      </button>
      <button className="ctx-menu__item" onClick={() => onNote(sessionId, currentNote)}>
        {currentNote ? 'Edit note…' : 'Add note…'}
      </button>
      <div className="ctx-menu__separator" />
      <button className="ctx-menu__item" onClick={() => onMove(sessionId)}>
        Move to branch…
      </button>
      <div className="ctx-menu__separator" />
      <button
        className="ctx-menu__item ctx-menu__item--danger"
        onClick={() => onCloseTab(sessionId)}
      >
        Close tab
      </button>
    </div>
  )
}
