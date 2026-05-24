import React, { useState, useRef } from 'react'
import type { Workspace } from '../../../shared/types/index'
import type { GlobalTabRegistration } from '../../extensions/registry'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSessionStore } from '../../stores/session.store'
import { useExtensionRegistry } from '../../extensions/registry'
import { AlertBadge } from '../AlertBadge'
import { ActivitySpinner } from '../ActivitySpinner'
import { ConfirmDialog } from '../ConfirmDialog'
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

interface WorkspaceRailProps {
  globalTabs?: GlobalTabRegistration[]
  activeGlobalTabId?: string | null
  onSelectGlobalTab?: (id: string) => void
}

export function WorkspaceRail({
  globalTabs = [],
  activeGlobalTabId = null,
  onSelectGlobalTab,
}: WorkspaceRailProps): JSX.Element {
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

  const pinnedTab = globalTabs.find((t) => t.id === 'core.overview')
  const otherTabs = globalTabs.filter((t) => t.id !== 'core.overview')

  return (
    <aside className="ws-rail">
      {pinnedTab && (
        <>
          <button
            className={`ws-rail__global-tab${activeGlobalTabId === pinnedTab.id ? ' ws-rail__global-tab--active' : ''}`}
            onClick={() => onSelectGlobalTab?.(pinnedTab.id)}
            title={pinnedTab.label}
          >
            {pinnedTab.icon ?? pinnedTab.label[0]}
          </button>
          <div className="ws-rail__divider" />
        </>
      )}

      {workspaces.map((ws, index) => (
        <div
          key={ws.id}
          draggable
          onDragStart={() => handleDragStart(index)}
          onDragOver={(e) => handleDragOver(e, index)}
          onDragLeave={() => setDragOver(null)}
          onDrop={() => handleDrop(index)}
          onDragEnd={() => {
            dragIndexRef.current = null
            setDragOver(null)
          }}
          className={`ws-tile-wrap${dragOver === index ? ' ws-tile-wrap--dnd-over' : ''}`}
        >
          <WorkspaceTile workspace={ws} />
        </div>
      ))}

      <div className="ws-rail__spacer" />

      {otherTabs.map((tab) => (
        <button
          key={tab.id}
          className={`ws-rail__global-tab${activeGlobalTabId === tab.id ? ' ws-rail__global-tab--active' : ''}`}
          onClick={() => onSelectGlobalTab?.(tab.id)}
          title={tab.label}
        >
          {tab.icon ?? tab.label[0]}
        </button>
      ))}

      <button className="ws-rail__add" onClick={() => setCreateOpen(true)} title="Create workspace">
        +
      </button>

      {createOpen && <CreateWorkspaceDialog onClose={() => setCreateOpen(false)} />}
    </aside>
  )
}

function WorkspaceTile({ workspace }: { workspace: Workspace }): JSX.Element {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { activeWorkspaceId, setActiveWorkspace, deleteWorkspace, projectsByWorkspaceId } =
    useWorkspaceStore()
  const { getBellCountForProject, isProjectBusy } = useSessionStore()
  const isActive = activeWorkspaceId === workspace.id
  const projects = projectsByWorkspaceId.get(workspace.id) ?? []
  const bellCount = projects.reduce((sum, p) => sum + getBellCountForProject(p.id), 0)
  const isBusy = projects.some((p) => isProjectBusy(p.id))

  function handleClick(): void {
    setActiveWorkspace(workspace.id)
    useExtensionRegistry.getState().setActiveGlobalTab(null)
  }

  function handleContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  function handleRemove(): void {
    setCtxMenu(null)
    setConfirmOpen(true)
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
        <div className="ws-tile__indicators">
          <AlertBadge count={bellCount} />
          {isBusy && <ActivitySpinner />}
        </div>
        <span className="ws-tile__initials">{getInitials(workspace.name)}</span>
        <span className="ws-tile__tooltip">{workspace.name}</span>
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onEdit={() => {
            setEditOpen(true)
            setCtxMenu(null)
          }}
          onRemove={handleRemove}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {editOpen && <EditWorkspaceDialog workspace={workspace} onClose={() => setEditOpen(false)} />}

      {confirmOpen && (
        <ConfirmDialog
          title={`Remove workspace "${workspace.name}"?`}
          description={`This will permanently delete all ${projects.length} project${projects.length !== 1 ? 's' : ''} in this workspace.`}
          confirmLabel="Remove"
          danger
          onConfirm={() => {
            deleteWorkspace(workspace.id)
            setConfirmOpen(false)
          }}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </>
  )
}

function ContextMenu({
  x,
  y,
  onEdit,
  onRemove,
  onClose,
}: {
  x: number
  y: number
  onEdit: () => void
  onRemove: () => void
  onClose: () => void
}): JSX.Element {
  React.useEffect(() => {
    const close = (): void => onClose()
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [onClose])

  return (
    <div className="ctx-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      <button className="ctx-menu__item" onClick={onEdit}>
        Edit workspace
      </button>
      <div className="ctx-menu__separator" />
      <button className="ctx-menu__item ctx-menu__item--danger" onClick={onRemove}>
        Remove workspace
      </button>
    </div>
  )
}
