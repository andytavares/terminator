import React, { useState } from 'react'
import { Check } from 'lucide-react'
import type { IndexedProject } from '../vault/types'
import { logReviewAction } from '../utils/review-log'

interface Props {
  activeProjects: IndexedProject[]
  onComplete: () => void
  reviewId: string | null
}

export function WeeklyReviewStep3Projects({
  activeProjects,
  onComplete,
  reviewId,
}: Props): React.JSX.Element {
  const [projects, setProjects] = useState(activeProjects)

  async function updateStatus(project: IndexedProject, status: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:update-project-status', {
      projectFilePath: project.filePath,
      status,
    })
    logReviewAction(reviewId, {
      step: 3,
      action: 'project-status',
      entityType: 'project',
      entityId: project.id,
      entityLabel: project.name,
      detail: status,
    })
    setProjects((prev) => prev.filter((p) => p.filePath !== project.filePath))
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
                  <button
                    className="tv-btn tv-btn--secondary"
                    onClick={() => updateStatus(project, 'someday')}
                  >
                    Someday
                  </button>
                  <button
                    className="tv-btn tv-btn--secondary"
                    onClick={() => updateStatus(project, 'archived')}
                  >
                    Archive
                  </button>
                </>
              ) : (
                <button
                  className="tv-btn tv-btn--primary"
                  onClick={() => updateStatus(project, 'active')}
                >
                  Keep <Check size={14} />
                </button>
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
