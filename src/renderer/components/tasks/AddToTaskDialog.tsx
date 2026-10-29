import React, { useState } from 'react'
import { Checkbox, ModalShell } from '@terminator/extension-ui'
import { plural } from '@terminator/extension-sdk/plain'
import { useTaskStore } from '../../stores/task.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { recordUse } from '../../usage/record'
import { useAddToTaskStore } from './add-to-task'
import {
  addLanesToTask,
  createTaskFrom,
  holdsLane,
  openTasksMatching,
  sameNameCards,
  useLaneCards,
} from './add-to-task-model'
import type { Task, TaskLane } from '../../../shared/schemas/tasks.schema'
import '../home/StartWork.css'
import './AddToTaskDialog.css'

const REFUSED = 'The task could not be changed. Try again.'

/** The picker for one lane, mounted once for the whole app; closed until `openAddToTask`. */
export function AddToTaskDialog(): React.JSX.Element | null {
  const lane = useAddToTaskStore((s) => s.lane)
  const close = useAddToTaskStore((s) => s.close)
  if (lane === null) return null
  return <TaskPicker lane={lane} onClose={close} />
}

interface PickerState {
  typed: string
  setTyped: (typed: string) => void
  alsoSuggested: boolean
  setAlsoSuggested: (ticked: boolean) => void
  error: string | null
  setError: (message: string | null) => void
}

function usePickerState(): PickerState {
  const [typed, setTyped] = useState('')
  const [alsoSuggested, setAlsoSuggested] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return { typed, setTyped, alsoSuggested, setAlsoSuggested, error, setError }
}

interface PickerProps {
  lane: TaskLane
  onClose: () => void
}

function TaskPicker({ lane, onClose }: PickerProps): React.JSX.Element {
  const state = usePickerState()
  const tasks = useTaskStore((s) => s.tasks)
  const suggested = sameNameCards(useLaneCards(), lane).map((c) => c.lane)
  const lanes = state.alsoSuggested ? [lane, ...suggested] : [lane]
  const finish = async (done: Promise<boolean>): Promise<void> =>
    (await done) ? (recordUse('core.tasks.add'), onClose()) : state.setError(REFUSED)
  return (
    <ModalShell label="Add to task" placement="top" onDismiss={onClose}>
      <div className="add-to-task">
        <FilterBox typed={state.typed} onType={state.setTyped} />
        <OpenTasks
          tasks={openTasksMatching(tasks, state.typed)}
          lane={lane}
          onPick={(task) => void finish(addLanesToTask(task.id, lanes))}
        />
        <NewTask lane={lane} onPick={() => void finish(createTaskFrom(lanes))} />
        <Suggestion count={suggested.length} branch={lane.branch} state={state} />
        {state.error !== null && (
          <div role="alert" className="add-to-task__error">
            {state.error}
          </div>
        )}
      </div>
    </ModalShell>
  )
}

function FilterBox({ typed, onType }: { typed: string; onType: (typed: string) => void }) {
  return (
    <input
      autoFocus
      className="add-to-task__filter"
      aria-label="Find a task"
      placeholder="Find a task"
      value={typed}
      onChange={(e) => onType(e.target.value)}
    />
  )
}

interface OpenTasksProps {
  tasks: Task[]
  lane: TaskLane
  onPick: (task: Task) => void
}

function OpenTasks({ tasks, lane, onPick }: OpenTasksProps): React.JSX.Element {
  return (
    <>
      <h3 className="add-to-task__group">Open tasks</h3>
      {tasks.map((task) => {
        const here = holdsLane(task, lane)
        return (
          <button
            key={task.id}
            type="button"
            className="add-to-task__choice"
            disabled={here}
            onClick={() => onPick(task)}
          >
            {task.title}
            {here && <span className="add-to-task__note">Already in this task</span>}
          </button>
        )
      })}
    </>
  )
}

function NewTask({ lane, onPick }: { lane: TaskLane; onPick: () => void }): React.JSX.Element {
  const named = useWorkspaceStore((s) => s.workspaces.find((w) => w.folderPath === lane.repoRoot))
  const repoName = named?.name ?? lane.repoRoot.split('/').pop()
  return (
    <>
      <h3 className="add-to-task__group">Or</h3>
      <button type="button" className="add-to-task__choice" onClick={onPick}>
        {`+ New task from ${repoName}/${lane.branch}`}
      </button>
    </>
  )
}

interface SuggestionProps {
  count: number
  branch: string
  state: PickerState
}

/** An offer only: the other branches join the task once this is ticked and a task is chosen. */
function Suggestion({ count, branch, state }: SuggestionProps): React.JSX.Element | null {
  if (count === 0) return null
  return (
    <div className="add-to-task__suggestion">
      <Checkbox
        checked={state.alsoSuggested}
        label="Add them too"
        onChange={state.setAlsoSuggested}
      />
      <span>
        Suggested: {count} other {plural(count, 'branch', 'branches')} named <b>{branch}</b>. Add
        them too?
      </span>
    </div>
  )
}
