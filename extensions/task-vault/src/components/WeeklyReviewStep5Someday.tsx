import React, { useState } from 'react'
import type { IndexedProject, IndexedTask } from '../vault/types'

interface Props {
  somedayProjects: IndexedProject[]
  somedayTasks: IndexedTask[]
  onComplete: () => void
}

export function WeeklyReviewStep5Someday({
  somedayProjects,
  somedayTasks,
  onComplete,
}: Props): React.JSX.Element {
  const [projects, setProjects] = useState(somedayProjects)
  const [tasks, setTasks] = useState(somedayTasks)

  async function updateProjectStatus(filePath: string, status: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:update-project-status', {
      projectFilePath: filePath,
      status,
    })
    setProjects((prev) => prev.filter((p) => p.filePath !== filePath))
  }

  async function promoteTask(taskId: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:someday-to-today', { taskId })
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
  }

  async function archiveTask(taskId: string) {
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:cancel-task', { taskId })
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
  }

  const isEmpty = projects.length === 0 && tasks.length === 0

  return (
    <div className="wr-step wr-step-5">
      <h3>Step 5: Someday / Maybe</h3>
      <p>Review your backlog. Pick up what's ready or archive what's no longer relevant.</p>

      {isEmpty && <p className="wr-step__done">Nothing in the backlog.</p>}

      {tasks.length > 0 && (
        <>
          <h4 className="wr-step__section-title">Backlog Tasks</h4>
          <ul className="wr-step__list">
            {tasks.map((task) => (
              <li key={task.id} className="wr-step__item">
                <span className="wr-step__project-name">{task.text}</span>
                <span className="wr-step__project-actions">
                  <button
                    className="tv-btn tv-btn--primary"
                    onClick={() => void promoteTask(task.id)}
                  >
                    Pick up today
                  </button>
                  <button
                    className="tv-btn tv-btn--secondary"
                    onClick={() => void archiveTask(task.id)}
                  >
                    Archive
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {projects.length > 0 && (
        <>
          <h4 className="wr-step__section-title">Someday Projects</h4>
          <ul className="wr-step__list">
            {projects.map((project) => (
              <li key={project.id} className="wr-step__item">
                <span className="wr-step__project-name">{project.name}</span>
                <span className="wr-step__project-actions">
                  <button
                    className="tv-btn tv-btn--primary"
                    onClick={() => void updateProjectStatus(project.filePath, 'active')}
                  >
                    Promote to active
                  </button>
                  <button
                    className="tv-btn tv-btn--secondary"
                    onClick={() => void updateProjectStatus(project.filePath, 'archived')}
                  >
                    Archive
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <button className="wr-step__next" onClick={onComplete}>
        Next
      </button>
    </div>
  )
}
