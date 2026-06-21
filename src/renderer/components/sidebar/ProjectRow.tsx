import React, { useState, useRef, useEffect } from 'react'
import { GitBranch, FolderGit2, ChevronRight, ChevronDown } from 'lucide-react'
import type { Project } from '../../../shared/types/index'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSessionStore } from '../../stores/session.store'
import { useBranchSync } from '../../hooks/useBranchSync'
import { ConfirmDialog } from '../ConfirmDialog'
import { SessionRow } from './SessionRow'
import './ProjectRow.css'

interface ProjectRowProps {
  project: Project
  workspaceId: string
  isActive: boolean
  isExpanded: boolean
  workspaceColor: string
  onSelect: () => void
  onAddSession: () => void
  onToggleExpand?: () => void
  gitDirty?: boolean
  gitConflict?: boolean
  onBranchBadgeClick?: () => void
  branchSwitcher?: React.ReactNode
  searchQuery?: string
}

export function ProjectRow({
  project,
  workspaceId,
  isActive,
  isExpanded,
  workspaceColor,
  onSelect,
  onAddSession,
  onToggleExpand,
  gitDirty,
  gitConflict,
  onBranchBadgeClick,
  branchSwitcher,
  searchQuery = '',
}: ProjectRowProps): JSX.Element {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [sessionDragOver, setSessionDragOver] = useState<number | null>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  const sessionDragIndexRef = useRef<number | null>(null)
  const { deleteProject, renameProject, workspaces } = useWorkspaceStore()
  const {
    getSessionsForProject,
    activeSessionIdByProject,
    getBellCountForProject,
    isProjectBusy,
    isSessionBusy,
  } = useSessionStore()
  const workspace = workspaces.find((w) => w.id === workspaceId)
  const cwd = project.worktreePath ?? workspace?.folderPath ?? ''
  useBranchSync(project, cwd)

  const sessions = getSessionsForProject(project.id)
  const activeSessionId = activeSessionIdByProject.get(project.id) ?? null
  const isBusy = isProjectBusy(project.id)

  const rootSessions = sessions.filter((s) => !s.parentSessionId)
  const childSessionsByParentId = new Map<string, typeof sessions>()
  for (const s of sessions) {
    if (s.parentSessionId) {
      const arr = childSessionsByParentId.get(s.parentSessionId) ?? []
      arr.push(s)
      childSessionsByParentId.set(s.parentSessionId, arr)
    }
  }

  const lowerQuery = searchQuery.toLowerCase()
  const projectNameMatches = !lowerQuery || project.name.toLowerCase().includes(lowerQuery)
  const isDimmed =
    !!lowerQuery &&
    !projectNameMatches &&
    !sessions.some((s) => s.tabTitle.toLowerCase().includes(lowerQuery))

  useEffect(() => {
    function closeHandler() {
      setCtxMenu(null)
    }
    window.addEventListener('close-context-menus', closeHandler)
    return () => window.removeEventListener('close-context-menus', closeHandler)
  }, [])

  function handleContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    window.dispatchEvent(new CustomEvent('close-context-menus'))
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
        {sessions.length > 0 && onToggleExpand && (
          <button
            className="project-row__expand-toggle"
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand()
            }}
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        )}
        <span className="project-row__icon">
          {project.isWorktree ? <FolderGit2 size={12} /> : <GitBranch size={12} />}
        </span>
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
          {!branchSwitcher && project.gitBranch && (
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

      {branchSwitcher && (
        <div className="project-row__branch-row" onClick={(e) => e.stopPropagation()}>
          {branchSwitcher}
        </div>
      )}

      {isExpanded &&
        rootSessions.map((session, index) => (
          <div key={session.id}>
            <div
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
                  const reordered = [...rootSessions]
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
                isBusy={isSessionBusy(session.id)}
                bellCount={getBellCountForProject(project.id)}
                workspaceColor={workspaceColor}
                onSelect={() => {
                  onSelect()
                  useSessionStore.getState().setActiveSessionForProject(project.id, session.id)
                }}
                onRename={(newTitle) =>
                  useSessionStore.getState().renameSession(session.id, newTitle)
                }
                hidden={
                  !!lowerQuery &&
                  !session.tabTitle.toLowerCase().includes(lowerQuery) &&
                  !projectNameMatches
                }
              />
            </div>
            {(childSessionsByParentId.get(session.id) ?? []).map((child) => (
              <SessionRow
                key={child.id}
                session={child}
                isActive={activeSessionId === child.id}
                isBusy={isSessionBusy(session.id)}
                bellCount={getBellCountForProject(project.id)}
                workspaceColor={workspaceColor}
                isSubSession
                onSelect={() => {
                  onSelect()
                  useSessionStore.getState().setActiveSessionForProject(project.id, child.id)
                }}
                onRename={(newTitle) =>
                  useSessionStore.getState().renameSession(child.id, newTitle)
                }
                hidden={
                  !!lowerQuery &&
                  !child.tabTitle.toLowerCase().includes(lowerQuery) &&
                  !projectNameMatches
                }
              />
            ))}
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
