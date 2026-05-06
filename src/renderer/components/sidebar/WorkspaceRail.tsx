import React, { useState, useRef } from 'react'
import type { Workspace } from '../../../shared/types/index'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import { EditWorkspaceDialog } from './EditWorkspaceDialog'
import './WorkspaceRail.css'

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

function colorWithAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export function WorkspaceRail(): JSX.Element {
  const [createOpen, setCreateOpen] = useState(false)
  const { workspaces, reorderWorkspaces } = useWorkspaceStore()
  const dragIndexRef = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  function handleDragStart(index: number): void {
    dragIndexRef.current = index
  }

  function handleDragOver(e: React.DragEvent, index: number): void {
    e.preventDefault()
    setDragOver(index)
  }

  function handleDrop(dropIndex: number): void {
    const fromIndex = dragIndexRef.current
    if (fromIndex === null || fromIndex === dropIndex) {
      setDragOver(null)
      dragIndexRef.current = null
      return
    }
    const reordered = [...workspaces]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(dropIndex, 0, moved)
    reorderWorkspaces(reordered.map((w) => w.id))
    dragIndexRef.current = null
    setDragOver(null)
  }

  return (
    <aside className="ws-rail">
      {workspaces.map((ws, index) => (
        <div
          key={ws.id}
          draggable
          onDragStart={() => handleDragStart(index)}
          onDragOver={(e) => handleDragOver(e, index)}
          onDragLeave={() => setDragOver(null)}
          onDrop={() => handleDrop(index)}
          onDragEnd={() => { dragIndexRef.current = null; setDragOver(null) }}
          className={`ws-tile-wrap${dragOver === index ? ' ws-tile-wrap--dnd-over' : ''}`}
        >
          <WorkspaceTile workspace={ws} />
        </div>
      ))}

      <div className="ws-rail__spacer" />

      <button
        className="ws-rail__add"
        onClick={() => setCreateOpen(true)}
        title="Create workspace"
      >
        +
      </button>

      {createOpen && <CreateWorkspaceDialog onClose={() => setCreateOpen(false)} />}
    </aside>
  )
}

function WorkspaceTile({ workspace }: { workspace: Workspace }): JSX.Element {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const { activeWorkspaceId, setActiveWorkspace, deleteWorkspace } = useWorkspaceStore()
  const isActive = activeWorkspaceId === workspace.id

  function handleClick(): void {
    setActiveWorkspace(workspace.id)
  }

  function handleContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  function handleRemove(): void {
    if (window.confirm(`Remove workspace "${workspace.name}" and all its projects?`)) {
      deleteWorkspace(workspace.id)
    }
    setCtxMenu(null)
  }

  return (
    <>
      <div
        className={`ws-tile${isActive ? ' ws-tile--active' : ''}`}
        style={{
          background: colorWithAlpha(workspace.color, isActive ? 0.28 : 0.16),
          ['--ws-color' as string]: workspace.color,
        }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        title=""
      >
        <span className="ws-tile__initials">{getInitials(workspace.name)}</span>
        <span className="ws-tile__tooltip">{workspace.name}</span>
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onEdit={() => { setEditOpen(true); setCtxMenu(null) }}
          onRemove={handleRemove}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {editOpen && (
        <EditWorkspaceDialog workspace={workspace} onClose={() => setEditOpen(false)} />
      )}
    </>
  )
}

function ContextMenu({
  x, y, onEdit, onRemove, onClose,
}: {
  x: number; y: number; onEdit: () => void; onRemove: () => void; onClose: () => void
}): JSX.Element {
  React.useEffect(() => {
    const close = (): void => onClose()
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [onClose])

  return (
    <div
      className="ctx-menu"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button className="ctx-menu__item" onClick={onEdit}>Edit workspace</button>
      <div className="ctx-menu__separator" />
      <button className="ctx-menu__item ctx-menu__item--danger" onClick={onRemove}>
        Remove workspace
      </button>
    </div>
  )
}
