import React, { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import type { Workspace, Project } from '../../../shared/types/index'
import { useExtensionRegistry } from '../../extensions/registry'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSettingsStore } from '../../stores/settings.store'
import { useTerminalSession } from '../../hooks/useTerminalSession'
import { CreateProjectDialog } from './CreateProjectDialog'
import { EditWorkspaceDialog } from './EditWorkspaceDialog'
import { ConfirmDialog } from '../ConfirmDialog'
import { ProjectRow } from './ProjectRow'
import { useDragReorder } from '../../hooks/useDragReorder'
import { ContextMenu, closeAllContextMenus } from '../ContextMenu'
import { BranchSwitcher } from './BranchSwitcher'
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
  const workspaceTabs = useExtensionRegistry((s) => s.workspaceTabs)
  const {
    deleteWorkspace,
    resolveActiveCwd,
    collapsedProjectIds,
    toggleProjectCollapse,
    ensureProjectExpanded,
  } = useWorkspaceStore()
  const { resolveSettings } = useSettingsStore()
  const { createSession } = useTerminalSession()
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const { reorderProjects } = useWorkspaceStore()
  const { dragOverIndex, getItemProps } = useDragReorder(projects, (reordered) =>
    reorderProjects(
      workspace.id,
      reordered.map((p) => p.id)
    )
  )

  function handleContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    closeAllContextMenus()
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
          <div className="ws-card__name-row">
            <span className="ws-card__name">{workspace.name}</span>
            {workspace.tags.map((tag) => (
              <span key={tag} className="ws-card__tag">
                {tag}
              </span>
            ))}
          </div>
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
                {...getItemProps(index)}
                className={dragOverIndex === index ? 'proj-dnd-target' : ''}
              >
                <ProjectRow
                  project={project}
                  workspaceId={workspace.id}
                  isActive={activeProjectId === project.id}
                  isExpanded={!collapsedProjectIds.has(project.id)}
                  onToggleExpand={() => toggleProjectCollapse(project.id)}
                  workspaceColor={workspace.color}
                  onSelect={() => {
                    ensureProjectExpanded(project.id)
                    onSelectProject(project.id)
                  }}
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
                  branchSwitcher={
                    <BranchSwitcher
                      project={project}
                      workspaceFolderPath={workspace.folderPath}
                      workspaceId={workspace.id}
                    />
                  }
                  searchQuery={searchQuery}
                />
              </div>
            ))}
            <button className="ws-card__add-project" onClick={() => setCreateOpen(true)}>
              <span>+</span>
              <span>New project</span>
            </button>
          </div>
        )}
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onDismiss={() => setCtxMenu(null)}
          items={[
            {
              label: 'Edit workspace',
              onSelect: () => {
                setEditOpen(true)
                setCtxMenu(null)
              },
            },
            {
              label: 'Remove workspace',
              danger: true,
              separatorBefore: true,
              onSelect: () => {
                setCtxMenu(null)
                setConfirmOpen(true)
              },
            },
          ]}
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
