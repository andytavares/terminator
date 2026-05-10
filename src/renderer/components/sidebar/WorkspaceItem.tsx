import React, { useState, useRef, useEffect } from 'react'
import type { Workspace } from '../../../shared/types/index'
import { ProjectItem } from './ProjectItem'
import { EditWorkspaceDialog } from './EditWorkspaceDialog'
import { CreateProjectDialog } from './CreateProjectDialog'
import { ConfirmDialog } from '../ConfirmDialog'
import { useWorkspaceStore } from '../../stores/workspace.store'
import './WorkspaceItem.css'

interface Props {
  workspace: Workspace
  collapsed: boolean
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

export function WorkspaceItem({ workspace, collapsed }: Props): JSX.Element {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [extMenuItems, setExtMenuItems] = useState<Array<{ id: string; label: string }>>([])
  const ref = useRef<HTMLDivElement>(null)
  const { activeWorkspaceId, setActiveWorkspace, deleteWorkspace, projectsByWorkspaceId } =
    useWorkspaceStore()

  useEffect(() => {
    window.electronAPI.extension
      .getContextMenuItems('workspace')
      .then((r) => setExtMenuItems(r.items ?? []))
  }, [])

  const isActive = activeWorkspaceId === workspace.id
  const projects = projectsByWorkspaceId.get(workspace.id) ?? []

  function handleClick(): void {
    if (!isActive) setActiveWorkspace(workspace.id)
    setExpanded((e) => !e)
  }

  function handleContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  function handleRemove(): void {
    setContextMenu(null)
    setConfirmOpen(true)
  }

  if (collapsed) {
    return (
      <div
        className={`workspace-avatar${isActive ? ' workspace-avatar--active' : ''}`}
        style={{ backgroundColor: workspace.color }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        title={workspace.name}
      >
        {getInitials(workspace.name)}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onEdit={() => {
              setEditOpen(true)
              setContextMenu(null)
            }}
            onRemove={handleRemove}
            onClose={() => setContextMenu(null)}
            extItems={extMenuItems}
            onExtItemClick={(itemId) => {
              window.electronAPI.extension.contextMenuClick('workspace', itemId, workspace.id)
              setContextMenu(null)
            }}
          />
        )}
        {editOpen && (
          <EditWorkspaceDialog workspace={workspace} onClose={() => setEditOpen(false)} />
        )}
      </div>
    )
  }

  return (
    <div ref={ref} className={`workspace-item${isActive ? ' workspace-item--active' : ''}`}>
      <div
        className="workspace-item__header"
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <span
          className="workspace-item__color-strip"
          style={{ backgroundColor: workspace.color }}
        />
        <span className="workspace-item__name">{workspace.name}</span>
        <span className="workspace-item__chevron">{expanded ? '▾' : '▸'}</span>
      </div>

      {(workspace.tags?.length ?? 0) > 0 && (
        <div className="workspace-item__tags">
          {workspace.tags.map((tag) => (
            <span key={tag} className="workspace-item__tag">
              {tag}
            </span>
          ))}
        </div>
      )}

      {expanded && isActive && (
        <div className="workspace-item__projects">
          {projects.map((project) => (
            <ProjectItem key={project.id} project={project} />
          ))}
          <button
            className="workspace-item__add-project"
            onClick={() => setCreateProjectOpen(true)}
          >
            + Add Project
          </button>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onEdit={() => {
            setEditOpen(true)
            setContextMenu(null)
          }}
          onRemove={handleRemove}
          onClose={() => setContextMenu(null)}
          extItems={extMenuItems}
          onExtItemClick={(itemId) => {
            window.electronAPI.extension.contextMenuClick('workspace', itemId, workspace.id)
            setContextMenu(null)
          }}
        />
      )}

      {editOpen && <EditWorkspaceDialog workspace={workspace} onClose={() => setEditOpen(false)} />}
      {createProjectOpen && (
        <CreateProjectDialog
          workspaceId={workspace.id}
          onClose={() => setCreateProjectOpen(false)}
        />
      )}

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
    </div>
  )
}

function ContextMenu({
  x,
  y,
  onEdit,
  onRemove,
  onClose,
  extItems,
  onExtItemClick,
}: {
  x: number
  y: number
  onEdit: () => void
  onRemove: () => void
  onClose: () => void
  extItems?: Array<{ id: string; label: string }>
  onExtItemClick?: (itemId: string) => void
}): JSX.Element {
  React.useEffect(() => {
    const handler = (): void => onClose()
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [onClose])

  return (
    <div
      className="context-menu"
      style={{ position: 'fixed', left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button className="context-menu__item" onClick={onEdit}>
        Edit
      </button>
      <button className="context-menu__item context-menu__item--danger" onClick={onRemove}>
        Remove
      </button>
      {extItems?.map((item) => (
        <button
          key={item.id}
          className="context-menu__item"
          onClick={() => onExtItemClick?.(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
