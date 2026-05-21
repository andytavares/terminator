import React, { useState } from 'react'
import { Check } from 'lucide-react'
import type { IndexedProject } from '../vault/types'

interface Props {
  activeProjects: IndexedProject[]
  onComplete: () => void
}

export function WeeklyReviewStep3Projects({
  activeProjects,
  onComplete,
}: Props): React.JSX.Element {
  const [projects, setProjects] = useState(activeProjects)

  async function updateStatus(filePath: string, status: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:update-project-status', {
      projectFilePath: filePath,
      status,
    })
    setProjects((prev) => prev.filter((p) => p.filePath !== filePath))
  }

  return (
    <div className="wr-step wr-step-3">
      <h3>Step 3: Review Projects</h3>
      <p>Review each project. Move stale ones or add next actions.</p>

      {projects.length === 0 && <p className="wr-step__done">All projects reviewed!</p>}

      <ul className="wr-step__list">
        {projects.map((project) => (
          <li
            key={project.id}
            className={`wr-step__item${project.isStale ? ' wr-step__item--stale' : ''}`}
          >
            <span className="wr-step__project-name">{project.name}</span>
            {project.isStale && <span className="wr-step__stale-badge">stale</span>}
            <span className="wr-step__project-actions">
              {project.isStale ? (
                <>
                  <button className="tv-btn tv-btn--secondary" onClick={() => updateStatus(project.filePath, 'someday')}>Someday</button>
                  <button className="tv-btn tv-btn--secondary" onClick={() => updateStatus(project.filePath, 'archived')}>
                    Archive
                  </button>
                </>
              ) : (
                <button className="tv-btn tv-btn--primary" onClick={() => updateStatus(project.filePath, 'active')}>Keep <Check size={14} /></button>
              )}
            </span>
          </li>
        ))}
      </ul>

      <button className="wr-step__next" onClick={onComplete}>
        Next
      </button>
    </div>
  )
}
