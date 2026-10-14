import React, { useState } from 'react'
import { IconButton } from '@terminator/extension-ui'
import { CalendarCheck, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import type { IndexedTask } from '../vault/types'
import { TaskTextEditor, draftOf } from './inline-edits'
import { bindId, invokeVault, pointerWhen, rawTaskText } from './daily-log-format'

/** What the backlog rows can do; each is optional. */
interface BacklogActions {
  onPickUpToday?: (taskId: string) => Promise<void>
  onDelete?: (taskId: string) => Promise<void>
  onRefreshBacklog?: () => Promise<void>
  onSelect?: (taskId: string) => void
}

interface BacklogRowProps {
  task: IndexedTask
  actions: BacklogActions
}

interface TagProps {
  kind: string
  prefix: string
  value?: string
}

interface TaskOnlyProps {
  task: IndexedTask
}

interface BacklogEditProps {
  edit: BacklogEdit
}

interface BacklogSectionProps {
  tasks: IndexedTask[]
  isEmptyDay: boolean
  actions: BacklogActions
}

type BacklogEdit = ReturnType<typeof useBacklogEdit>

/** Editing a backlog task; a blank edit puts the text back. */
function useBacklogEdit(task: IndexedTask, onRefreshBacklog?: () => Promise<void>) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(task.text)
  const start = () => {
    setEditText(rawTaskText(task))
    setEditing(true)
  }
  async function save() {
    if (!editText.trim()) {
      setEditing(false)
      setEditText(task.text)
      return
    }
    await invokeVault('task-vault:vault:edit-task', { taskId: task.id, text: editText.trim() })
    setEditing(false)
    await onRefreshBacklog?.()
  }
  return { editing, setEditing, editText, setEditText, start, save }
}

function BacklogEditor({ edit }: BacklogEditProps): React.JSX.Element {
  return <TaskTextEditor draft={draftOf(edit)} className="daily-log__task-edit" />
}

/** One tag after the task text, when the task has it. */
function Tag(props: TagProps): React.JSX.Element | null {
  if (!props.value) return null
  return (
    <span className={`daily-log__tag daily-log__tag--${props.kind}`}>
      {props.prefix}
      {props.value}
    </span>
  )
}

function BacklogTags({ task }: TaskOnlyProps): React.JSX.Element {
  return (
    <>
      <Tag kind="project" prefix="@" value={task.project} />
      <Tag kind="area" prefix="#" value={task.area} />
      <Tag kind="context" prefix="+" value={task.context} />
    </>
  )
}

function BacklogText(props: BacklogRowProps & BacklogEditProps): React.JSX.Element {
  const { task } = props
  const { onSelect } = props.actions
  return (
    <span
      className="daily-log__backlog-task-text"
      onClick={bindId(onSelect, task.id)}
      onDoubleClick={props.edit.start}
      style={pointerWhen(onSelect)}
      title="Click to open detail · Double-click to edit"
    >
      {task.text}
      <BacklogTags task={task} />
    </span>
  )
}

function BacklogRowActions({ task, actions }: BacklogRowProps): React.JSX.Element {
  const { onPickUpToday, onDelete } = actions
  return (
    <span className="daily-log__backlog-actions">
      {onPickUpToday && (
        <IconButton
          icon={CalendarCheck}
          label="Pick up today"
          size="sm"
          onClick={() => void onPickUpToday(task.id)}
        />
      )}
      {onDelete && (
        <IconButton icon={Trash2} label="Delete" size="sm" onClick={() => void onDelete(task.id)} />
      )}
    </span>
  )
}

function BacklogTaskRow(props: BacklogRowProps): React.JSX.Element {
  const edit = useBacklogEdit(props.task, props.actions.onRefreshBacklog)
  return (
    <div className="daily-log__backlog-task">
      <span className="daily-log__backlog-spacer" />
      {edit.editing ? (
        <BacklogEditor edit={edit} />
      ) : (
        <BacklogText task={props.task} actions={props.actions} edit={edit} />
      )}
      {!edit.editing && <BacklogRowActions task={props.task} actions={props.actions} />}
    </div>
  )
}

function BacklogList(props: BacklogSectionProps): React.JSX.Element | null {
  if (props.tasks.length > 0) {
    return (
      <>
        {props.tasks.map((task) => (
          <BacklogTaskRow key={task.id} task={task} actions={props.actions} />
        ))}
      </>
    )
  }
  if (props.isEmptyDay) return null
  return <p className="daily-log__backlog-empty">No backlog items.</p>
}

/** The backlog under the day: collapsible, and quiet when the whole day is empty. */
export function BacklogSection(props: BacklogSectionProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
  return (
    <>
      <div className="daily-log__backlog-divider" />
      <button className="daily-log__backlog-header" onClick={() => setExpanded((v) => !v)}>
        <span className="daily-log__backlog-label">Backlog ({props.tasks.length})</span>
        {expanded ? (
          <ChevronDown className="tm-icon-sm" />
        ) : (
          <ChevronRight className="tm-icon-sm" />
        )}
      </button>
      {expanded && (
        <div className="daily-log__backlog-list">
          <BacklogList tasks={props.tasks} isEmptyDay={props.isEmptyDay} actions={props.actions} />
        </div>
      )}
    </>
  )
}
