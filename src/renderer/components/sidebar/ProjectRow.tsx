import React, { useState, useRef } from 'react'
import type { Project } from '../../../shared/types/index'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSessionStore } from '../../stores/session.store'
import { ConfirmDialog } from '../ConfirmDialog'
import { SessionRow } from './SessionRow'
import './ProjectRow.css'

interface ProjectRowProps {
  project: Project
  isActive: boolean
  isExpanded: boolean
  workspaceColor: string
  onSelect: () => void
  onAddSession: () => void
  gitDirty?: boolean
  gitConflict?: boolean
  onBranchBadgeClick?: () => void
  searchQuery?: string
}

export function ProjectRow({
  project,
  isActive,
  isExpanded,
  workspaceColor,
  onSelect,
  onAddSession,
  gitDirty,
  gitConflict,
  onBranchBadgeClick,
  searchQuery = '',
}: ProjectRowProps): JSX.Element {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [sessionDragOver, setSessionDragOver] = useState<number | null>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  const sessionDragIndexRef = useRef<number | null>(null)
  const { deleteProject, renameProject } = useWorkspaceStore()
  const { getSessionsForProject, activeSessionIdByProject, getBellCountForProject, isProjectBusy } =
    useSessionStore()

  const sessions = getSessionsForProject(project.id)
  const activeSessionId = activeSessionIdByProject.get(project.id) ?? null
  const isBusy = isProjectBusy(project.id)

  const lowerQuery = searchQuery.toLowerCase()
  const projectNameMatches = !lowerQuery || project.name.toLowerCase().includes(lowerQuery)
  const isDimmed =
    !!lowerQuery &&
    !projectNameMatches &&
    !sessions.some((s) => s.tabTitle.toLowerCase().includes(lowerQuery))

  function handleContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  function startRename(): void {
    setRenameValue(project.name)
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
    await renameProject(project.id, trimmed)
    setRenaming(false)
  }

  function handleRenameKey(e: React.KeyboardEvent): void {
    if (e.key === 'Enter') void commitRename()
    if (e.key === 'Escape') setRenaming(false)
  }

  function handleRemove(): void {
    setCtxMenu(null)
    setConfirmOpen(true)
  }

  return (
    <>
      <div
        className={`project-row${isActive ? ' project-row--active' : ''}${isDimmed ? ' project-row--dimmed' : ''}`}
        style={{ ['--ws-color' as string]: workspaceColor }}
        onClick={onSelect}
        onContextMenu={handleContextMenu}
        draggable
      >
        <span className="project-row__icon">⎇</span>
        {renaming ? (
          <input
            ref={renameRef}
            className="project-row__rename-input"
            value={renameValue}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={handleRenameKey}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="project-row__name" title={project.name} onDoubleClick={startRename}>
            {project.name}
          </span>
        )}
        <div className="project-row__badges">
          {project.gitBranch && (
            <span
              className={`project-row__branch-chip ${
                gitConflict ? 'chip-conflict' : gitDirty ? 'chip-dirty' : 'chip-clean'
              }`}
              onClick={(e) => {
                e.stopPropagation()
                onBranchBadgeClick?.()
              }}
            >
              {project.gitBranch}
            </span>
          )}
        </div>
        {isBusy && <span className="project-row__busy" />}
        {isExpanded && (
          <button
            className="project-row__add-session"
            onClick={(e) => {
              e.stopPropagation()
              onAddSession()
            }}
            title="New terminal"
          >
            +
          </button>
        )}
      </div>

      {isExpanded &&
        sessions.map((session, index) => (
          <div
            key={session.id}
            draggable
            onDragStart={() => {
              sessionDragIndexRef.current = index
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setSessionDragOver(index)
            }}
            onDragLeave={() => setSessionDragOver(null)}
            onDrop={() => {
              const from = sessionDragIndexRef.current
              if (from !== null && from !== index) {
                const reordered = [...sessions]
                const [moved] = reordered.splice(from, 1)
                reordered.splice(index, 0, moved)
                useSessionStore.getState().reorderSessions(
                  project.id,
                  reordered.map((s) => s.id)
                )
              }
              sessionDragIndexRef.current = null
              setSessionDragOver(null)
            }}
            onDragEnd={() => {
              sessionDragIndexRef.current = null
              setSessionDragOver(null)
            }}
            className={sessionDragOver === index ? 'session-dnd-over' : ''}
          >
            <SessionRow
              session={session}
              isActive={activeSessionId === session.id}
              isBusy={false}
              bellCount={getBellCountForProject(project.id)}
              workspaceColor={workspaceColor}
              onSelect={() => {
                onSelect()
                useSessionStore.getState().setActiveSessionForProject(project.id, session.id)
              }}
              onRename={() => {}}
              hidden={
                !!lowerQuery &&
                !session.tabTitle.toLowerCase().includes(lowerQuery) &&
                !projectNameMatches
              }
            />
          </div>
        ))}

      {ctxMenu && (
        <ProjectRowCtxMenu
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
            void deleteProject(project.id)
            setConfirmOpen(false)
          }}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </>
  )
}

function ProjectRowCtxMenu({
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
