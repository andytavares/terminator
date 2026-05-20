import React, { useEffect, useState } from 'react'
import type { IndexedProject } from '../vault/types'

function LinkToTerminator({ filePath }: { filePath: string }): React.JSX.Element {
  const [linking, setLinking] = useState(false)
  const [targetId, setTargetId] = useState('')
  const [linked, setLinked] = useState(false)

  async function confirm() {
    if (!targetId.trim()) return
    await window.electronAPI.extensionBridge.invoke('task-vault:links:create', {
      projectFilePath: filePath,
      targetId: targetId.trim(),
    })
    setLinked(true)
    setLinking(false)
    setTargetId('')
  }

  if (linked)
    return (
      <span className="projects-browser__linked-badge" title="Linked">
        ⚡
      </span>
    )
  if (!linking)
    return (
      <button
        className="projects-browser__link-btn"
        onClick={() => setLinking(true)}
        title="Link to Terminator session"
      >
        Link to Terminator…
      </button>
    )
  return (
    <span className="projects-browser__link-picker">
      <input
        type="text"
        placeholder="Paste terminal UUID…"
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        autoFocus
      />
      <button onClick={confirm} disabled={!targetId.trim()}>
        Link
      </button>
      <button onClick={() => setLinking(false)}>✕</button>
    </span>
  )
}

export function ProjectsBrowser(): React.JSX.Element {
  const [projects, setProjects] = useState<IndexedProject[]>([])
  const [isLoading, setIsLoading] = useState(true)

  async function load() {
    setIsLoading(true)
    const result = await window.electronAPI.extensionBridge.invoke('task-vault:projects:list', {})
    if (result && typeof result === 'object' && 'projects' in result) {
      setProjects((result as { projects: IndexedProject[] }).projects)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleUpdateStatus(filePath: string, status: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:update-project-status', {
      projectFilePath: filePath,
      status,
    })
    await load()
  }

  if (isLoading) return <div className="projects-browser__loading">Loading projects…</div>

  return (
    <div className="projects-browser">
      <h2>Projects</h2>
      {projects.length === 0 && <p className="projects-browser__empty">No active projects.</p>}
      {projects.map((project) => (
        <div
          key={project.id}
          className={`projects-browser__card${project.isStale ? ' projects-browser__card--stale' : ''}`}
        >
          <div className="projects-browser__card-header">
            <span className="projects-browser__name">{project.name}</span>
            {project.area && <span className="projects-browser__area">#{project.area}</span>}
            {project.deadline && (
              <span className="projects-browser__deadline">due: {project.deadline}</span>
            )}
          </div>
          <div className="projects-browser__stats">
            <span>{project.nextActionCount} next actions</span>
            <LinkToTerminator filePath={project.filePath} />
          </div>
          {project.isStale && (
            <div className="projects-browser__stale-info">
              <span className="projects-browser__stale-badge">
                {project.nextActionCount === 0 ? 'no next action' : 'inactive'}
              </span>
              <div className="projects-browser__stale-actions">
                <button
                  className="projects-browser__action-btn"
                  onClick={() => handleUpdateStatus(project.filePath, 'someday')}
                >
                  Move to Someday
                </button>
                <button
                  className="projects-browser__action-btn projects-browser__action-btn--danger"
                  onClick={() => handleUpdateStatus(project.filePath, 'archived')}
                >
                  Archive
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
