import React, { useState } from 'react'
import type { Project } from '../../../shared/types/index'
import { useWorkspaceStore } from '../../stores/workspace.store'
import './ProjectItem.css'

interface Props {
  project: Project
}

export function ProjectItem({ project }: Props): JSX.Element {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const { activeProjectId, setActiveProject, deleteProject } = useWorkspaceStore()
  const isActive = activeProjectId === project.id

  function handleContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  function handleRemove(): void {
    if (window.confirm(`Remove project "${project.name}"?`)) {
      deleteProject(project.id)
    }
    setContextMenu(null)
  }

  return (
    <div
      className={`project-item${isActive ? ' project-item--active' : ''}`}
      onClick={() => setActiveProject(project.id)}
      onContextMenu={handleContextMenu}
    >
      <span className="project-item__name">{project.name}</span>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onRemove={handleRemove}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

function ContextMenu({
  x,
  y,
  onRemove,
  onClose,
}: {
  x: number
  y: number
  onRemove: () => void
  onClose: () => void
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
      <button className="context-menu__item context-menu__item--danger" onClick={onRemove}>
        Remove
      </button>
    </div>
  )
}
