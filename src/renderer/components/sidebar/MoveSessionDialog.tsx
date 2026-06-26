import React, { useEffect, useState } from 'react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSessionStore } from '../../stores/session.store'
import { SCRATCH_PROJECT_ID } from '../../../shared/types/index'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import { useModalEffect } from '../../stores/modal.store'
import './Dialog.css'
import './MoveSessionDialog.css'

interface Props {
  sessionId: string
  onClose: () => void
  onMoved?: (targetProjectId: string, targetWorkspaceId: string) => void
}

type SubView = null | { type: 'new-project'; workspaceId: string } | { type: 'new-workspace' }

export function MoveSessionDialog({ sessionId, onClose, onMoved }: Props): JSX.Element {
  useModalEffect()
  const {
    workspaces,
    projectsByWorkspaceId,
    loadProjects,
    createProject,
    setActiveWorkspace,
    setActiveProject,
  } = useWorkspaceStore()
  const { moveSession, getSessionsForProject } = useSessionStore()
  const [subView, setSubView] = useState<SubView>(null)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectError, setNewProjectError] = useState('')
  const [loading, setLoading] = useState(false)

  // Load projects for all workspaces that haven't been loaded yet
  useEffect(() => {
    for (const ws of workspaces) {
      if (!projectsByWorkspaceId.has(ws.id)) {
        void loadProjects(ws.id)
      }
    }
  }, [workspaces, projectsByWorkspaceId, loadProjects])

  const session = useSessionStore.getState().sessions.get(sessionId)
  const currentProjectId = session?.projectId ?? null

  async function handleSelectProject(
    targetProjectId: string,
    targetWorkspaceId: string
  ): Promise<void> {
    if (targetProjectId === currentProjectId) {
      onClose()
      return
    }
    moveSession(sessionId, targetProjectId)
    // Auto-delete the source project if it's now empty and not scratch
    if (currentProjectId && currentProjectId !== SCRATCH_PROJECT_ID) {
      const remaining = getSessionsForProject(currentProjectId)
      if (remaining.length === 0) {
        await useWorkspaceStore.getState().deleteProject(currentProjectId)
      }
    }
    setActiveWorkspace(targetWorkspaceId)
    setActiveProject(targetProjectId)
    onMoved?.(targetProjectId, targetWorkspaceId)
    onClose()
  }

  async function handleCreateProject(workspaceId: string): Promise<void> {
    const name = newProjectName.trim()
    if (!name) {
      setNewProjectError('Name is required')
      return
    }
    setLoading(true)
    setNewProjectError('')
    const result = await createProject({ workspaceId, name })
    setLoading(false)
    if ('error' in result) {
      setNewProjectError(
        result.error === 'DUPLICATE_NAME' ? 'Name already in use' : 'Could not create project'
      )
      return
    }
    await handleSelectProject(result.project.id, workspaceId)
  }

  if (subView?.type === 'new-workspace') {
    return <CreateWorkspaceDialog onClose={onClose} />
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog move-session-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="dialog__title">Move to project</h2>

        {subView?.type === 'new-project' ? (
          <div className="move-session-dialog__new-project">
            <div className="dialog__field">
              <label className="dialog__label">Project name</label>
              <input
                className={`dialog__input${newProjectError ? ' dialog__input--error' : ''}`}
                value={newProjectName}
                onChange={(e) => {
                  setNewProjectName(e.target.value)
                  setNewProjectError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreateProject(subView.workspaceId)
                  if (e.key === 'Escape') setSubView(null)
                }}
                placeholder="My project"
                autoFocus
              />
              {newProjectError && <span className="dialog__error">{newProjectError}</span>}
            </div>
            <div className="dialog__actions">
              <button className="dialog__btn-secondary" onClick={() => setSubView(null)}>
                Back
              </button>
              <button
                className="dialog__btn-primary"
                onClick={() => void handleCreateProject(subView.workspaceId)}
                disabled={loading}
              >
                Create & move
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="move-session-dialog__list">
              {workspaces.map((ws) => {
                const projects = projectsByWorkspaceId.get(ws.id) ?? []
                return (
                  <div key={ws.id} className="move-session-dialog__workspace">
                    <div
                      className="move-session-dialog__ws-header"
                      style={{ ['--ws-color' as string]: ws.color }}
                    >
                      <span
                        className="move-session-dialog__ws-dot"
                        style={{ background: ws.color }}
                      />
                      {ws.name}
                    </div>
                    {projects.map((project) => (
                      <button
                        key={project.id}
                        className={`move-session-dialog__project${project.id === currentProjectId ? ' move-session-dialog__project--current' : ''}`}
                        onClick={() => void handleSelectProject(project.id, ws.id)}
                        disabled={project.id === currentProjectId}
                      >
                        {project.name}
                        {project.id === currentProjectId && (
                          <span className="move-session-dialog__current-label">current</span>
                        )}
                      </button>
                    ))}
                    <button
                      className="move-session-dialog__new-btn"
                      onClick={() => {
                        setNewProjectName('')
                        setNewProjectError('')
                        setSubView({ type: 'new-project', workspaceId: ws.id })
                      }}
                    >
                      + New project in {ws.name}
                    </button>
                  </div>
                )
              })}
            </div>
            <div className="move-session-dialog__footer">
              <button
                className="move-session-dialog__new-btn move-session-dialog__new-workspace-btn"
                onClick={() => setSubView({ type: 'new-workspace' })}
              >
                + New workspace
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
