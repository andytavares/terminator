import React, { useState } from 'react'
import { Button, IconButton } from '@terminator/extension-ui'
import { Pencil, Trash2, X } from 'lucide-react'
import type { IndexedTask } from '../vault/types'
import { SmartTaskInput } from './SmartTaskInput'
import { StatusIcon } from './DailyLogStatusIcon'
import { notify } from '../utils/notify'
import { invokeVault, makeTaskNavHandler, modifier } from './daily-log-format'

interface SubtaskRowProps {
  subtask: IndexedTask
  onRefresh: () => Promise<void>
}

interface GhostProps {
  taskId: string
  onRefresh: () => Promise<void>
}

interface DraftRowProps {
  draft: SubtaskDraft
  className: string
}

interface SubtaskEditProps {
  edit: SubtaskActions
}

type SubtaskActions = ReturnType<typeof useSubtaskActions>

type SubtaskDraft = ReturnType<typeof useSubtaskDraft>

/** Editing, completing and deleting one subtask. */
function useSubtaskActions(subtask: IndexedTask, onRefresh: () => Promise<void>) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(subtask.text)
  async function saveSubtaskEdit() {
    if (!editText.trim()) return
    await invokeVault('task-vault:vault:edit-task', { taskId: subtask.id, text: editText.trim() })
    setEditing(false)
    await onRefresh()
  }
  async function complete() {
    await invokeVault('task-vault:vault:complete-task', { taskId: subtask.id })
    notify('success', `Completed: ${subtask.text}`, {
      key: 'taskCompleted',
      onClick: makeTaskNavHandler(subtask.id),
    })
    await onRefresh()
  }
  async function remove() {
    if (!confirm(`Delete subtask: "${subtask.text}"?`)) return
    await invokeVault('task-vault:vault:delete-task', { taskId: subtask.id })
    await onRefresh()
  }
  return { editing, setEditing, editText, setEditText, saveSubtaskEdit, complete, remove }
}

function SubtaskEditor({ edit }: SubtaskEditProps): React.JSX.Element {
  return (
    <span className="daily-log__subtask-edit">
      <SmartTaskInput
        autoFocus
        value={edit.editText}
        onChange={edit.setEditText}
        onSubmit={() => void edit.saveSubtaskEdit()}
        onCancel={() => edit.setEditing(false)}
      />
      <Button variant="primary" onClick={() => void edit.saveSubtaskEdit()}>
        Save
      </Button>
      <IconButton icon={X} label="Cancel edit" onClick={() => edit.setEditing(false)} />
    </span>
  )
}

function SubtaskMarker(props: SubtaskRowProps & SubtaskEditProps): React.JSX.Element {
  if (props.subtask.status !== 'open') {
    return (
      <span className="daily-log__task-marker">
        <StatusIcon status={props.subtask.status} />
      </span>
    )
  }
  return (
    <button
      className="daily-log__task-checkbox"
      onClick={() => void props.edit.complete()}
      title="Complete subtask"
    >
      <StatusIcon status={props.subtask.status} />
    </button>
  )
}

function SubtaskText(props: SubtaskRowProps & SubtaskEditProps): React.JSX.Element {
  const { status, text } = props.subtask
  const struck = status === 'done' || status === 'migrated'
  return (
    <span
      className={`daily-log__subtask-text${modifier(struck, 'daily-log__task-text--strikethrough')}`}
      onDoubleClick={status === 'open' ? () => props.edit.setEditing(true) : undefined}
    >
      {text}
    </span>
  )
}

function SubtaskActionButtons(props: SubtaskRowProps & SubtaskEditProps): React.JSX.Element {
  const { edit } = props
  return (
    <span className="daily-log__subtask-actions">
      {props.subtask.status === 'open' && (
        <IconButton icon={Pencil} label="Edit" size="sm" onClick={() => edit.setEditing(true)} />
      )}
      <IconButton icon={Trash2} label="Delete" size="sm" onClick={() => void edit.remove()} />
    </span>
  )
}

export function SubtaskRow(props: SubtaskRowProps): React.JSX.Element {
  const edit = useSubtaskActions(props.subtask, props.onRefresh)
  const done = props.subtask.status === 'done'
  return (
    <div className={`daily-log__subtask${modifier(done, 'daily-log__subtask--done')}`}>
      <SubtaskMarker subtask={props.subtask} onRefresh={props.onRefresh} edit={edit} />
      {edit.editing ? (
        <SubtaskEditor edit={edit} />
      ) : (
        <SubtaskText subtask={props.subtask} onRefresh={props.onRefresh} edit={edit} />
      )}
      {!edit.editing && (
        <SubtaskActionButtons subtask={props.subtask} onRefresh={props.onRefresh} edit={edit} />
      )}
    </div>
  )
}

/** A subtask being written under a task: open or not, its text, and the add. */
export function useSubtaskDraft(taskId: string, onRefresh: () => Promise<void>) {
  const [active, setActive] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const cancelNewSubtask = () => {
    setText('')
    setActive(false)
  }
  async function addNewSubtask() {
    if (!text.trim()) return
    setSaving(true)
    try {
      await invokeVault('task-vault:vault:add-subtask', { taskId, text: text.trim() })
      cancelNewSubtask()
      await onRefresh()
    } finally {
      setSaving(false)
    }
  }
  return { active, setActive, text, setText, saving, add: addNewSubtask, cancel: cancelNewSubtask }
}

/** The input row a new subtask is written in. */
export function SubtaskDraftRow({ draft, className }: DraftRowProps): React.JSX.Element {
  return (
    <div className={className}>
      <SmartTaskInput
        autoFocus
        value={draft.text}
        onChange={draft.setText}
        onSubmit={() => void draft.add()}
        onCancel={draft.cancel}
        placeholder="Subtask…"
        disabled={draft.saving}
      />
      <Button
        size="sm"
        onClick={() => void draft.add()}
        disabled={draft.saving || !draft.text.trim()}
      >
        Add
      </Button>
      <IconButton icon={X} label="Cancel" size="sm" onClick={draft.cancel} />
    </div>
  )
}

export function GhostAddSubtaskRow(props: GhostProps): React.JSX.Element {
  const draft = useSubtaskDraft(props.taskId, props.onRefresh)
  if (!draft.active) {
    return (
      <button className="daily-log__ghost-subtask" onClick={() => draft.setActive(true)}>
        · + Add subtask…
      </button>
    )
  }
  return <SubtaskDraftRow draft={draft} className="daily-log__subtask-add-row" />
}
