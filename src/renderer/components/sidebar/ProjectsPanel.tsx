import React, { useState, useRef } from 'react'
import type { Project } from '../../../shared/types/index'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSessionStore } from '../../stores/session.store'
import { AlertBadge } from '../AlertBadge'
import { ConfirmDialog } from '../ConfirmDialog'
import { CreateProjectDialog } from './CreateProjectDialog'
import { BranchSwitcher } from './BranchSwitcher'
import './ProjectsPanel.css'

interface Props {
  workspaceId: string
}

export function ProjectsPanel({ workspaceId }: Props): JSX.Element {
  const [createOpen, setCreateOpen] = useState(false)
  const { workspaces, projectsByWorkspaceId } = useWorkspaceStore()

  const workspace = workspaces.find((w) => w.id === workspaceId)
  const projects = projectsByWorkspaceId.get(workspaceId) ?? []

  if (!workspace) return <></>

  const projectCount = projects.length

  return (
    <div className="projects-panel" style={{ ['--ws-color' as string]: workspace.color }}>
      <div className="projects-panel__header">
        <div className="projects-panel__ws-label">
          <span className="projects-panel__ws-dot" style={{ background: workspace.color }} />
          <span className="projects-panel__ws-name">{workspace.name}</span>
        </div>
        <div className="projects-panel__ws-meta">
          {projectCount} {projectCount === 1 ? 'project' : 'projects'}
        </div>
      </div>

      {workspace.tags.length > 0 && (
        <div className="projects-panel__tags">
          {workspace.tags.map((tag) => (
            <span key={tag} className="projects-panel__tag">
              {tag}
            </span>
          ))}
        </div>
      )}

      <ProjectList
        workspaceId={workspaceId}
        projects={projects}
        workspaceColor={workspace.color}
        workspaceFolderPath={workspace.folderPath}
      />

      <button className="projects-panel__add" onClick={() => setCreateOpen(true)}>
        <span>+</span>
        <span>New project</span>
      </button>

      {createOpen && (
        <CreateProjectDialog workspaceId={workspaceId} onClose={() => setCreateOpen(false)} />
      )}
    </div>
  )
}

function ProjectList({
  workspaceId,
  projects,
  workspaceColor,
  workspaceFolderPath,
}: {
  workspaceId: string
  projects: Project[]
  workspaceColor: string
  workspaceFolderPath: string
}): JSX.Element {
  const { reorderProjects } = useWorkspaceStore()
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
    const reordered = [...projects]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(dropIndex, 0, moved)
    reorderProjects(
      workspaceId,
      reordered.map((p) => p.id)
    )
    dragIndexRef.current = null
    setDragOver(null)
  }

  return (
    <div className="projects-panel__list">
      {projects.length > 0 && <div className="projects-panel__section-label">Projects</div>}
      {projects.map((project, index) => (
        <div
          key={project.id}
          draggable
          onDragStart={() => handleDragStart(index)}
          onDragOver={(e) => handleDragOver(e, index)}
          onDragLeave={() => setDragOver(null)}
          onDrop={() => handleDrop(index)}
          onDragEnd={() => {
            dragIndexRef.current = null
            setDragOver(null)
          }}
          className={dragOver === index ? 'proj-dnd-target' : ''}
        >
          <ProjectCard
            project={project}
            workspaceColor={workspaceColor}
            workspaceFolderPath={workspaceFolderPath}
          />
        </div>
      ))}
    </div>
  )
}

function ProjectCard({
  project,
  workspaceColor,
  workspaceFolderPath,
}: {
  project: Project
  workspaceColor: string
  workspaceFolderPath: string
}): JSX.Element {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState('')
  const renameRef = useRef<HTMLInputElement>(null)
  const { activeProjectId, setActiveProject, deleteProject, renameProject } = useWorkspaceStore()
  const { getBellCountForProject } = useSessionStore()
  const isActive = activeProjectId === project.id
  const bellCount = getBellCountForProject(project.id)

  function handleClick(): void {
    if (!renaming) setActiveProject(project.id)
  }

  function handleContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  function startRename(): void {
    setRenameValue(project.name)
    setRenameError('')
    setRenaming(true)
    setCtxMenu(null)
    setTimeout(() => renameRef.current?.select(), 0)
  }

  async function commitRename(): Promise<void> {
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === project.name) {
      setRenaming(false)
      return
    }

    const result = await renameProject(project.id, trimmed)
    if ('error' in result) {
      if (result.error === 'DUPLICATE_NAME') {
        setRenameError('Name already in use')
      }
      return
    }
    setRenaming(false)
  }

  function handleRenameKey(e: React.KeyboardEvent): void {
    if (e.key === 'Enter') commitRename()
    if (e.key === 'Escape') setRenaming(false)
  }

  function handleRemove(): void {
    setCtxMenu(null)
    setConfirmOpen(true)
  }

  return (
    <>
      <div
        className={`proj-card${isActive ? ' proj-card--active' : ''}`}
        style={{ ['--ws-color' as string]: workspaceColor }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <AlertBadge count={bellCount} className="alert-badge--corner" />
        <span className="proj-card__drag-handle" title="Drag to reorder">
          ⠿
        </span>

        <div className="proj-card__body">
          {renaming ? (
            <div className="proj-card__rename">
              <input
                ref={renameRef}
                className={`proj-card__rename-input${renameError ? ' proj-card__rename-input--error' : ''}`}
                value={renameValue}
                autoFocus
                onChange={(e) => {
                  setRenameValue(e.target.value)
                  setRenameError('')
                }}
                onBlur={commitRename}
                onKeyDown={handleRenameKey}
                onClick={(e) => e.stopPropagation()}
              />
              {renameError && <span className="proj-card__rename-error">{renameError}</span>}
            </div>
          ) : (
            <>
              <span className="proj-card__name" onDoubleClick={startRename}>
                {project.name}
              </span>
              <span
                className="proj-card__rename-icon"
                title="Rename"
                onClick={(e) => {
                  e.stopPropagation()
                  startRename()
                }}
              >
                ✎
              </span>
            </>
          )}

          {isActive && (project.gitBranch || project.worktreePath) && !renaming && (
            <BranchSwitcher project={project} workspaceFolderPath={workspaceFolderPath} />
          )}
        </div>

        <button
          className="proj-card__menu-btn"
          onClick={(e) => {
            e.stopPropagation()
            setCtxMenu({ x: e.clientX, y: e.clientY })
          }}
          title="Options"
        >
          ···
        </button>
      </div>

      {ctxMenu && (
        <ProjectCtxMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onRename={startRename}
          onRemove={handleRemove}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {confirmOpen && (
        <ConfirmDialog
          title={`Remove project "${project.name}"?`}
          confirmLabel="Remove"
          danger
          onConfirm={() => {
            deleteProject(project.id)
            setConfirmOpen(false)
          }}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </>
  )
}

function ProjectCtxMenu({
  x,
  y,
  onRename,
  onRemove,
  onClose,
}: {
  x: number
  y: number
  onRename: () => void
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
      <button className="ctx-menu__item" onClick={onRename}>
        Rename
      </button>
      <div className="ctx-menu__separator" />
      <button className="ctx-menu__item ctx-menu__item--danger" onClick={onRemove}>
        Remove project
      </button>
    </div>
  )
}
