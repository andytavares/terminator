import React, { useState } from 'react'
import { useToastStore } from '../../../../src/renderer/stores/toast.store'
import type { IndexedTask } from '../vault/types'

interface Props {
  staleTasks: IndexedTask[]
  staleDaysThreshold: number
  onComplete: () => void
}

export function WeeklyReviewStepStaleTasks({
  staleTasks: initialTasks,
  staleDaysThreshold,
  onComplete,
}: Props): React.JSX.Element {
  const [tasks, setTasks] = useState(initialTasks)
  const { addToast } = useToastStore()

  function remove(taskId: string) {
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
  }

  async function handleBacklog(taskId: string) {
    const result = await window.electronAPI.extensionBridge.invoke(
      'task-vault:vault:process-inbox-item',
      { taskId, action: 'someday' }
    )
    if (result && 'error' in result) {
      addToast({ type: 'error', message: `Could not move to backlog: ${result.error}` })
      return
    }
    remove(taskId)
  }

  async function handleDelete(taskId: string) {
    const result = await window.electronAPI.extensionBridge.invoke('task-vault:vault:cancel-task', {
      taskId,
    })
    if (result && 'error' in result) {
      addToast({ type: 'error', message: `Could not delete task: ${result.error}` })
      return
    }
    remove(taskId)
  }

  async function handleKeep(taskId: string) {
    const result = await window.electronAPI.extensionBridge.invoke(
      'task-vault:vault:reset-today-since',
      { taskId }
    )
    if (result && 'error' in result) {
      addToast({ type: 'error', message: `Could not reset task: ${result.error}` })
      return
    }
    remove(taskId)
  }

  return (
    <div className="wr-step wr-step-stale">
      <h3>Step 4: Stale Tasks</h3>
      <p>
        These tasks have been rolling over for more than {staleDaysThreshold} day
        {staleDaysThreshold !== 1 ? 's' : ''}. Send them to the backlog, delete them, or keep them
        as-is.
      </p>

      {tasks.length === 0 && (
        <p className="wr-step__done">No stale tasks — nice work staying on top of things.</p>
      )}

      {tasks.length > 0 && (
        <ul className="wr-step__list">
          {tasks.map((task) => (
            <li key={task.id} className="wr-step__item wr-step__item--stale">
              <span className="wr-step__project-name">
                {task.text}
                {task.todaySince && (
                  <span
                    className="wr-step__stale-badge"
                    title={`In today view since ${task.todaySince}`}
                  >
                    since {task.todaySince}
                  </span>
                )}
              </span>
              <span className="wr-step__project-actions">
                <button
                  className="tv-btn tv-btn--secondary"
                  onClick={() => void handleBacklog(task.id)}
                  title="Move to backlog"
                >
                  Backlog
                </button>
                <button
                  className="tv-btn tv-btn--ghost tv-btn--danger-text"
                  onClick={() => void handleDelete(task.id)}
                  title="Cancel task"
                >
                  Delete
                </button>
                <button
                  className="tv-btn tv-btn--ghost"
                  onClick={() => void handleKeep(task.id)}
                  title="Keep rolling over (reset stale timer)"
                >
                  Keep
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <button className="wr-step__next" onClick={onComplete}>
        Next
      </button>
    </div>
  )
}
