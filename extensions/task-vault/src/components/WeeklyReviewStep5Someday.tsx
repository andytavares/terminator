import React, { useState } from 'react'
import type { IndexedProject } from '../vault/types'

interface Props {
  somedayProjects: IndexedProject[]
  onComplete: () => void
}

export function WeeklyReviewStep5Someday({
  somedayProjects,
  onComplete,
}: Props): React.JSX.Element {
  const [projects, setProjects] = useState(somedayProjects)

  async function updateStatus(filePath: string, status: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:update-project-status', {
      projectFilePath: filePath,
      status,
    })
    setProjects((prev) => prev.filter((p) => p.filePath !== filePath))
  }

  return (
    <div className="wr-step wr-step-5">
      <h3>Step 5: Someday / Maybe</h3>
      <p>Review your someday list. Promote or archive as needed.</p>

      {projects.length === 0 && <p className="wr-step__done">No someday projects.</p>}

      <ul className="wr-step__list">
        {projects.map((project) => (
          <li key={project.id} className="wr-step__item">
            <span className="wr-step__project-name">{project.name}</span>
            <span className="wr-step__project-actions">
              <button onClick={() => updateStatus(project.filePath, 'active')}>
                Promote to active
              </button>
              <button onClick={() => updateStatus(project.filePath, 'archived')}>Archive</button>
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
