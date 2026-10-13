import React, { useState } from 'react'
import { notify } from '../utils/notify'
import type { IndexedTask } from '../vault/types'
import { logReviewAction, type ReviewActionKind } from '../utils/review-log'
import { Button } from '@terminator/extension-ui'

interface Props {
  staleTasks: IndexedTask[]
  staleDaysThreshold: number
  onComplete: () => void
  reviewId: string | null
}

/** One way off the stale list: its channel, how it is logged, and what a failure says. */
interface StaleMove {
  channel: string
  extra?: Record<string, unknown>
  action: ReviewActionKind
  failure: string
  key: string
}

const BACKLOG: StaleMove = {
  channel: 'task-vault:vault:process-inbox-item',
  extra: { action: 'someday' },
  action: 'task-backlogged',
  failure: 'Could not move to backlog',
  key: 'staleTaskBacklogFailed',
}
const DELETE: StaleMove = {
  channel: 'task-vault:vault:cancel-task',
  action: 'task-deleted',
  failure: 'Could not delete task',
  key: 'staleTaskDeleteFailed',
}
const KEEP: StaleMove = {
  channel: 'task-vault:vault:reset-today-since',
  action: 'task-kept',
  failure: 'Could not reset task',
  key: 'staleTaskResetFailed',
}

interface RowProps {
  task: IndexedTask
  onMove: (taskId: string, move: StaleMove) => void
}

function StaleTaskRow({ task, onMove }: RowProps): React.JSX.Element {
  return (
    <li className="wr-step__item wr-step__item--stale">
      <span className="wr-step__project-name">
        {task.text}
        {task.todaySince && (
          <span className="wr-step__stale-badge" title={`In today view since ${task.todaySince}`}>
            since {task.todaySince}
          </span>
        )}
      </span>
      <span className="wr-step__project-actions">
        <Button onClick={() => onMove(task.id, BACKLOG)} title="Move to backlog">
          Backlog
        </Button>
        <Button variant="danger" onClick={() => onMove(task.id, DELETE)} title="Cancel task">
          Delete
        </Button>
        <Button
          variant="ghost"
          onClick={() => onMove(task.id, KEEP)}
          title="Keep rolling over (reset stale timer)"
        >
          Keep
        </Button>
      </span>
    </li>
  )
}

/** The stale tasks still to decide on, and the move that takes one off the list. */
function useStaleTasks(initialTasks: IndexedTask[], reviewId: string | null) {
  const [tasks, setTasks] = useState(initialTasks)

  async function move(taskId: string, how: StaleMove) {
    const result = await window.electronAPI.extensionBridge.invoke(how.channel, {
      taskId,
      ...how.extra,
    })
    if (typeof result === 'object' && result !== null && 'error' in result) {
      notify('error', `${how.failure}: ${result.error}`, how.key)
      return
    }
    const task = tasks.find((t) => t.id === taskId)
    logReviewAction(reviewId, {
      step: 4,
      action: how.action,
      entityType: 'task',
      entityId: taskId,
      entityLabel: task?.text ?? taskId,
    })
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
  }

  return { tasks, move }
}

export function WeeklyReviewStepStaleTasks(props: Props): React.JSX.Element {
  const { staleDaysThreshold, onComplete } = props
  const { tasks, move } = useStaleTasks(props.staleTasks, props.reviewId)
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
            <StaleTaskRow key={task.id} task={task} onMove={(id, how) => void move(id, how)} />
          ))}
        </ul>
      )}
      <Button variant="primary" onClick={onComplete}>
        Next: someday
      </Button>
    </div>
  )
}
