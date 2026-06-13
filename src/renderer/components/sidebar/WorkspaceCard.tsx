import React, { useRef, useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import type { Workspace, Project } from '../../../shared/types/index'
import { useExtensionRegistry } from '../../extensions/registry'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSettingsStore } from '../../stores/settings.store'
import { useTerminalSession } from '../../hooks/useTerminalSession'
import { CreateProjectDialog } from './CreateProjectDialog'
import { EditWorkspaceDialog } from './EditWorkspaceDialog'
import { ConfirmDialog } from '../ConfirmDialog'
import { ExtensionFooter } from './ExtensionFooter'
import { ProjectRow } from './ProjectRow'
import './WorkspaceCard.css'

interface WorkspaceCardProps {
  workspace: Workspace
  projects: Project[]
  isCollapsed: boolean
  onToggleCollapse: () => void
  activeProjectId: string | null
  onSelectProject: (projectId: string) => void
  onSelectWorkspaceTab?: (workspaceId: string, tabId: string) => void
  activeWorkspaceTabId?: string | null
  searchQuery?: string
}

export function WorkspaceCard({
  workspace,
  projects,
  isCollapsed,
  onToggleCollapse,
  activeProjectId,
  onSelectProject,
  onSelectWorkspaceTab,
  activeWorkspaceTabId,
  searchQuery = '',
}: WorkspaceCardProps): JSX.Element {
  const { sidebarButtons, workspaceTabs } = useExtensionRegistry((s) => ({
    sidebarButtons: s.sidebarButtons,
    workspaceTabs: s.workspaceTabs,
  }))
  const { deleteWorkspace, resolveActiveCwd } = useWorkspaceStore()
  const { resolveSettings } = useSettingsStore()
  const { createSession } = useTerminalSession()
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const dragIndexRef = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const { reorderProjects } = useWorkspaceStore()

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
    void reorderProjects(
      workspace.id,
      reordered.map((p) => p.id)
    )
    dragIndexRef.current = null
    setDragOver(null)
  }

  function handleContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  return (
    <>
      <div className="ws-card" style={{ ['--ws-color' as string]: workspace.color }}>
        <div className="ws-card__band" />
        <div
          className="ws-card__header"
          onClick={onToggleCollapse}
          onContextMenu={handleContextMenu}
        >
          <span className="ws-card__chevron">
            {isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
          </span>
          <span className="ws-card__name">{workspace.name}</span>
          {workspaceTabs.size > 0 && (
            <div className="ws-card__ws-tabs" onClick={(e) => e.stopPropagation()}>
              {Array.from(workspaceTabs.values()).map((tab) => (
                <button
                  key={tab.id}
                  className={`ws-card__ws-tab${activeWorkspaceTabId === tab.id ? ' ws-card__ws-tab--active' : ''}`}
                  title={tab.label}
                  onClick={() => onSelectWorkspaceTab?.(workspace.id, tab.id)}
                >
                  {tab.icon ?? tab.label[0]}
                </button>
              ))}
            </div>
          )}
          <span className="ws-card__project-count">{projects.length}</span>
        </div>

        {!isCollapsed && (
          <div className="ws-card__projects">
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
                <ProjectRow
                  project={project}
                  isActive={activeProjectId === project.id}
                  isExpanded={activeProjectId === project.id}
                  workspaceColor={workspace.color}
                  onSelect={() => onSelectProject(project.id)}
                  onAddSession={() => {
                    const cwd = resolveActiveCwd()
                    const settings = resolveSettings(workspace.id, project.id)
                    void createSession(
                      project.id,
                      'human',
                      '',
                      cwd,
                      settings.terminal.scrollbackLimit
                    )
                  }}
                  onBranchBadgeClick={() =>
                    useExtensionRegistry.getState().setActiveProjectTab('git')
                  }
                  searchQuery={searchQuery}
                />
              </div>
            ))}
            <button className="ws-card__add-project" onClick={() => setCreateOpen(true)}>
              <span>+</span>
              <span>New project</span>
            </button>
            <ExtensionFooter buttons={sidebarButtons} />
          </div>
        )}
      </div>

      {ctxMenu && (
        <WorkspaceCtxMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onEdit={() => {
            setEditOpen(true)
            setCtxMenu(null)
          }}
          onRemove={() => {
            setCtxMenu(null)
            setConfirmOpen(true)
          }}
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
            void deleteWorkspace(workspace.id)
            setConfirmOpen(false)
          }}
          onClose={() => setConfirmOpen(false)}
        />
      )}

      {createOpen && (
        <CreateProjectDialog workspaceId={workspace.id} onClose={() => setCreateOpen(false)} />
      )}
    </>
  )
}

function WorkspaceCtxMenu({
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
