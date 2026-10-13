import React, { useState } from 'react'
import { Button, IconButton } from '@terminator/extension-ui'
import { X } from 'lucide-react'
import { SmartTaskInput } from './SmartTaskInput'
import type { IndexedTask } from '../vault/types'

/** A task's text with its tags written back out, for editing. */
function taggedText(task: IndexedTask): string {
  const parts = [task.text]
  if (task.project) parts.push(`@${task.project}`)
  if (task.context) parts.push(`+${task.context}`)
  if (task.area) parts.push(`#${task.area}`)
  if (task.dueDate) parts.push(`due:${task.dueDate}`)
  return parts.join(' ')
}

/** A task's text being edited in place: the draft, and saving or dropping it. */
export interface TaskTextDraft {
  text: string
  setText: (text: string) => void
  save: () => void | Promise<void>
  cancel: () => void
}

/** What a task edit hook holds: whether it is open, the text, and the save. */
interface TaskEditState {
  editText: string
  setEditText: (text: string) => void
  setEditing: (editing: boolean) => void
  save: () => void | Promise<void>
}

/** The draft of a task edit whose Cancel closes it. */
export function draftOf(edit: TaskEditState): TaskTextDraft {
  return {
    text: edit.editText,
    setText: edit.setEditText,
    save: edit.save,
    cancel: () => edit.setEditing(false),
  }
}

/**
 * A task's tagged text as a draft: a blank one saves nothing; Save writes it,
 * closes the editor and then reloads what shows the task.
 */
export function useTaskTextDraft(
  task: IndexedTask,
  close: () => void,
  reload: () => Promise<unknown>
) {
  const [text, setText] = useState(() => taggedText(task))
  async function save() {
    if (!text.trim()) return
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:edit-task', {
      taskId: task.id,
      text: text.trim(),
    })
    close()
    await reload()
  }
  return { text, setText, save, cancel: close }
}

interface TaskTextEditorProps {
  draft: TaskTextDraft
  className: string
  /** The Save button's size; the design system's default when absent. */
  saveSize?: 'sm'
}

/** The smart input, Save and Cancel of a task edited in place. */
export function TaskTextEditor({ draft, className, saveSize }: TaskTextEditorProps) {
  const save = () => void draft.save()
  return (
    <span className={className}>
      <SmartTaskInput
        autoFocus
        value={draft.text}
        onChange={draft.setText}
        onSubmit={save}
        onCancel={draft.cancel}
      />
      <Button variant="primary" size={saveSize} onClick={save}>
        Save
      </Button>
      <IconButton icon={X} label="Cancel edit" size="sm" onClick={draft.cancel} />
    </span>
  )
}

/** A name being edited in place, and why the last save was refused. */
export interface RenameDraft {
  renameText: string
  setRenameText: (text: string) => void
  renameError: string | null
  save: () => Promise<void>
  cancel: () => void
}

/** The rename field of an area or a project; `scope` adds that view's own classes. */
export function RenameRow(props: { rename: RenameDraft; scope?: string }): React.JSX.Element {
  const { rename, scope } = props
  const scoped = (part: string) => `area-detail__${part}${scope ? ` ${scope}__${part}` : ''}`
  return (
    <div className={scoped('rename-row')}>
      <input
        autoFocus
        className={scoped('rename-input')}
        value={rename.renameText}
        onChange={(e) => rename.setRenameText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void rename.save()
          if (e.key === 'Escape') rename.cancel()
        }}
      />
      <Button variant="primary" size="sm" onClick={() => void rename.save()}>
        Save
      </Button>
      <IconButton icon={X} label="Cancel rename" size="sm" onClick={rename.cancel} />
      {rename.renameError && (
        <span className="area-detail__rename-error">{rename.renameError}</span>
      )}
    </div>
  )
}
