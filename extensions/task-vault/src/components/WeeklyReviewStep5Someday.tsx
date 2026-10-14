import React, { useState } from 'react'
import type { IndexedProject, IndexedTask } from '../vault/types'
import {
  logReviewAction,
  setProjectStatusInReview,
  type ReviewActionKind,
} from '../utils/review-log'
import { Button } from '@terminator/extension-ui'

interface Props {
  somedayProjects: IndexedProject[]
  somedayTasks: IndexedTask[]
  onComplete: () => void
  reviewId: string | null
}

interface TaskListProps {
  tasks: IndexedTask[]
  onPromote: (task: IndexedTask) => void
  onArchive: (task: IndexedTask) => void
}

function BacklogTasks({ tasks, onPromote, onArchive }: TaskListProps): React.JSX.Element | null {
  if (tasks.length === 0) return null
  return (
    <>
      <h4 className="wr-step__section-title">Backlog Tasks</h4>
      <ul className="wr-step__list">
        {tasks.map((task) => (
          <li key={task.id} className="wr-step__item">
            <span className="wr-step__project-name">{task.text}</span>
            <span className="wr-step__project-actions">
              <Button variant="primary" onClick={() => onPromote(task)}>
                Pick up today
              </Button>
              <Button onClick={() => onArchive(task)}>Archive</Button>
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

interface ProjectListProps {
  projects: IndexedProject[]
  onStatus: (project: IndexedProject, status: string) => void
}

function SomedayProjects({ projects, onStatus }: ProjectListProps): React.JSX.Element | null {
  if (projects.length === 0) return null
  return (
    <>
      <h4 className="wr-step__section-title">Someday Projects</h4>
      <ul className="wr-step__list">
        {projects.map((project) => (
          <li key={project.id} className="wr-step__item">
            <span className="wr-step__project-name">{project.name}</span>
            <span className="wr-step__project-actions">
              <Button variant="primary" onClick={() => onStatus(project, 'active')}>
                Promote to active
              </Button>
              <Button onClick={() => onStatus(project, 'archived')}>Archive</Button>
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

interface TaskMove {
  channel: string
  action: ReviewActionKind
}

const PROMOTE: TaskMove = { channel: 'task-vault:vault:someday-to-today', action: 'task-promoted' }
const ARCHIVE: TaskMove = { channel: 'task-vault:vault:cancel-task', action: 'task-archived' }

/** The backlog this step works through, and the moves that take items off it. */
function useBacklog(props: Props) {
  const { reviewId } = props
  const [projects, setProjects] = useState(props.somedayProjects)
  const [tasks, setTasks] = useState(props.somedayTasks)

  async function updateProjectStatus(project: IndexedProject, status: string) {
    await setProjectStatusInReview({ reviewId, step: 5 }, project, status)
    setProjects((prev) => prev.filter((p) => p.filePath !== project.filePath))
  }

  async function moveTask(task: IndexedTask, move: TaskMove) {
    await window.electronAPI.extensionBridge.invoke(move.channel, { taskId: task.id })
    logReviewAction(reviewId, {
      step: 5,
      action: move.action,
      entityType: 'task',
      entityId: task.id,
      entityLabel: task.text,
    })
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
  }

  return { projects, tasks, updateProjectStatus, moveTask }
}

export function WeeklyReviewStep5Someday(props: Props): React.JSX.Element {
  const { projects, tasks, updateProjectStatus, moveTask } = useBacklog(props)
  const isEmpty = projects.length === 0 && tasks.length === 0
  return (
    <div className="wr-step wr-step-5">
      <h3>Step 5: Someday / Maybe</h3>
      <p>Review your backlog. Pick up what's ready or archive what's no longer relevant.</p>
      {isEmpty && <p className="wr-step__done">Nothing in the backlog.</p>}
      <BacklogTasks
        tasks={tasks}
        onPromote={(task) => void moveTask(task, PROMOTE)}
        onArchive={(task) => void moveTask(task, ARCHIVE)}
      />
      <SomedayProjects
        projects={projects}
        onStatus={(project, status) => void updateProjectStatus(project, status)}
      />
      <Button variant="primary" onClick={props.onComplete}>
        Next: reflect
      </Button>
    </div>
  )
}
