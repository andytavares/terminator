import React, { useRef, useState } from 'react'
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

interface TerminalButtonProps {
  t: TerminalSession
  label?: string
  showContextMenu?: boolean
  /** Returns true, and clears the flag, when a long press just opened the menu. */
  consumeLongPress: () => boolean
  onSelectTerminal: (t: { sessionId: string; cwd: string }) => void
  onContextMenu?: (e: React.MouseEvent) => void
  onTouchStart?: (e: React.TouchEvent) => void
  onTouchEnd?: () => void
  onTouchMove?: () => void
}

function TerminalButton({
  t,
  label,
  consumeLongPress,
  onSelectTerminal,
  onContextMenu,
  onTouchStart,
  onTouchEnd,
  onTouchMove,
}: TerminalButtonProps) {
  return (
    <button
      className="mobile-list__terminal"
      type="button"
      onClick={() => {
        if (consumeLongPress()) return
        onSelectTerminal({ sessionId: t.sessionId, cwd: t.cwd })
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelectTerminal({ sessionId: t.sessionId, cwd: t.cwd })
      }}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchMove}
    >
      <span className="mobile-list__terminal-label">{label ?? basename(t.cwd)}</span>
    </button>
  )
}

const LONG_PRESS_MS = 500

type OpenMenu = (sessionId: string, x: number, y: number) => void

/** Touching a terminal for half a second opens its menu; lifting or moving first does not. */
function useLongPress(openMenu: OpenMenu) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }
  const startLongPress = (e: React.TouchEvent, sessionId: string) => {
    cancelLongPress()
    longPressFired.current = false
    const touch = e.touches[0]
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      openMenu(sessionId, touch.clientX, touch.clientY)
    }, LONG_PRESS_MS)
  }
  const consumeLongPress = () => {
    const fired = longPressFired.current
    longPressFired.current = false
    return fired
  }
  return { start: startLongPress, cancel: cancelLongPress, consumeLongPress }
}

/** A terminal belongs to the workspace it was assigned to, or else to the folder it runs in. */
function belongsTo(ws: Workspace, t: TerminalSession): boolean {
  if (t.workspaceId === ws.id) return true
  return !t.workspaceId && (t.cwd === ws.folderPath || t.cwd.startsWith(ws.folderPath + '/'))
}

/** Each workspace with its terminals, and the terminals in none of them. */
function groupTerminals(workspaces: Workspace[], terminals: TerminalSession[]) {
  const groups = workspaces.map((ws) => ({
    ws,
    terminals: terminals.filter((t) => belongsTo(ws, t)),
  }))
  const assigned = new Set(groups.flatMap((group) => group.terminals.map((t) => t.sessionId)))
  return { groups, scratch: terminals.filter((t) => !assigned.has(t.sessionId)) }
}

export function MobileTerminalList({ workspaces, terminals, ...handlers }: Props) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const openTerminalMenu: OpenMenu = (sessionId, x, y) => setContextMenu({ sessionId, x, y })
  const longPress = useLongPress(openTerminalMenu)
  const { groups, scratch } = groupTerminals(workspaces, terminals)

  return (
    <div className="mobile-list">
      {groups.map((group) => (
        <WorkspaceGroup
          key={group.ws.id}
          {...group}
          {...handlers}
          consumeLongPress={longPress.consumeLongPress}
        />
      ))}
      <ScratchTerminals
        terminals={scratch}
        longPress={longPress}
        onSelectTerminal={handlers.onSelectTerminal}
        openMenu={openTerminalMenu}
      />
      <MoveToWorkspaceMenu
        menu={contextMenu}
        workspaces={workspaces}
        onAssignWorkspace={handlers.onAssignWorkspace}
        onClose={() => setContextMenu(null)}
      />
    </div>
  )
}

interface WorkspaceGroupProps extends Pick<Props, 'onSelectTerminal' | 'onCreateTerminal'> {
  ws: Workspace
  terminals: TerminalSession[]
  consumeLongPress: () => boolean
}

function WorkspaceGroup({
  ws,
  terminals,
  consumeLongPress,
  onSelectTerminal,
  onCreateTerminal,
}: WorkspaceGroupProps) {
  return (
    <div className="mobile-list__workspace">
      <p className="mobile-list__workspace-name">{ws.name}</p>
      {terminals.map((t) => (
        <TerminalButton
          key={t.sessionId}
          t={t}
          consumeLongPress={consumeLongPress}
          onSelectTerminal={onSelectTerminal}
        />
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
}

interface ScratchTerminalsProps extends Pick<Props, 'onSelectTerminal'> {
  terminals: TerminalSession[]
  longPress: ReturnType<typeof useLongPress>
  openMenu: OpenMenu
}

/** Terminals in no workspace, which a right-click or a long press can move into one. */
function ScratchTerminals({
  terminals,
  longPress,
  onSelectTerminal,
  openMenu,
}: ScratchTerminalsProps) {
  return terminals.map((t, i) => (
    <TerminalButton
      key={t.sessionId}
      t={t}
      label={`Scratch ${i + 1} · ${basename(t.cwd)}`}
      showContextMenu
      consumeLongPress={longPress.consumeLongPress}
      onSelectTerminal={onSelectTerminal}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu(t.sessionId, e.clientX, e.clientY)
      }}
      onTouchStart={(e) => longPress.start(e, t.sessionId)}
      onTouchEnd={longPress.cancel}
      onTouchMove={longPress.cancel}
    />
  ))
}

interface MoveToWorkspaceMenuProps extends Pick<Props, 'workspaces' | 'onAssignWorkspace'> {
  menu: ContextMenuState | null
  onClose: () => void
}

function MoveToWorkspaceMenu({
  menu,
  workspaces,
  onAssignWorkspace,
  onClose,
}: MoveToWorkspaceMenuProps) {
  if (!menu) return null
  return (
    <>
      <div className="mobile-context-menu-backdrop" onClick={onClose} />
      <div className="mobile-context-menu" style={{ top: menu.y, left: menu.x }}>
        <p className="mobile-context-menu__label">Move to workspace</p>
        {workspaces.map((ws) => (
          <MenuItem
            key={ws.id}
            label={ws.name}
            onSelect={() => {
              onAssignWorkspace(menu.sessionId, ws.id)
              onClose()
            }}
          />
        ))}
        {workspaces.length === 0 && (
          <span className="mobile-context-menu__empty">No workspaces</span>
        )}
      </div>
    </>
  )
}

function MenuItem({ label, onSelect }: { label: string; onSelect: () => void }) {
  return (
    <button type="button" className="mobile-context-menu__item" onClick={onSelect}>
      {label}
    </button>
  )
}
