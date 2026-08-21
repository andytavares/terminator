import React, { useState, useRef } from 'react'
import { GitBranch, FolderGit2, ChevronRight, ChevronDown } from 'lucide-react'
import type { Project } from '../../../shared/types/index'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSessionStore } from '../../stores/session.store'
import { useBranchSync } from '../../hooks/useBranchSync'
import { useDragReorder } from '../../hooks/useDragReorder'
import { ConfirmDialog } from '../ConfirmDialog'
import { SessionRow } from './SessionRow'
import { ContextMenu, closeAllContextMenus } from '../ContextMenu'
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
  branchSwitcher,
  searchQuery = '',
}: ProjectRowProps): JSX.Element {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const renameRef = useRef<HTMLInputElement>(null)
  const { deleteProject, renameProject, workspaces } = useWorkspaceStore()
  const {
    getSessionsForProject,
    projectViews,
    getBellCountForSession,
    isProjectBusy,
    isSessionBusy,
  } = useSessionStore()
  const workspace = workspaces.find((w) => w.id === workspaceId)
  const cwd = project.worktreePath ?? workspace?.folderPath ?? ''
  useBranchSync(project, cwd)

  const sessions = getSessionsForProject(project.id)
  const activeSessionId = projectViews.get(project.id)?.activeSessionId ?? null
  const isBusy = isProjectBusy(project.id)

  const rootSessions = sessions.filter((s) => !s.parentSessionId)
  const { dragOverIndex: sessionDragOverIndex, getItemProps: getSessionDragProps } = useDragReorder(
    rootSessions,
    (reordered) =>
      useSessionStore.getState().reorderSessions(
        project.id,
        reordered.map((s) => s.id)
      )
  )
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

  function handleContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    closeAllContextMenus()
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
              {...getSessionDragProps(index)}
              className={sessionDragOverIndex === index ? 'session-dnd-over' : ''}
            >
              <SessionRow
                session={session}
                isActive={activeSessionId === session.id}
                isBusy={isSessionBusy(session.id)}
                bellCount={getBellCountForSession(session.id)}
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
                isBusy={isSessionBusy(child.id)}
                bellCount={getBellCountForSession(child.id)}
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
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onDismiss={() => setCtxMenu(null)}
          items={[
            { label: 'Rename', onSelect: startRename },
            {
              label: 'Remove project',
              danger: true,
              separatorBefore: true,
              onSelect: handleRemove,
            },
          ]}
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
