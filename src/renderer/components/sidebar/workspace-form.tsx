import React, { useState } from 'react'
import { Button, Dialog } from '@terminator/extension-ui'
import type { Workspace } from '../../../shared/types/index'
import { WORKSPACE_PRESET_COLORS as PRESET_COLORS } from './workspace-colors'
import './dialog-fields.css'

// The fields the Create and Edit workspace dialogs share, and their checks.

export interface WorkspaceDraft {
  name: string
  folderPath: string
  color: string
  /** Comma-separated, as typed. */
  tags: string
}

const DUPLICATE_NAME = 'A workspace with this name already exists'

/** Why `name` cannot be a workspace's name, or '' when it can. */
function workspaceNameError(name: string, nameTaken: (name: string) => boolean): string {
  if (!name.trim()) return 'Name is required'
  if (name.length > 100) return 'Name must be 100 characters or less'
  return nameTaken(name) ? DUPLICATE_NAME : ''
}

/** The draft, its errors, and the checks a submit runs first. */
export function useWorkspaceForm(initial: WorkspaceDraft, nameTaken: (name: string) => boolean) {
  const [draft, setDraft] = useState(initial)
  const [nameError, setNameError] = useState('')
  const [error, setError] = useState('')

  /** False, with the reason shown, when the name cannot be submitted. */
  const nameIsValid = (): boolean => {
    const reason = workspaceNameError(draft.name, nameTaken)
    setNameError(reason)
    return reason === ''
  }

  const updateForm = (patch: Partial<WorkspaceDraft>): void => setDraft((d) => ({ ...d, ...patch }))
  const tagList = (): string[] =>
    draft.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

  return {
    draft,
    update: updateForm,
    nameError,
    setNameError,
    error,
    setError,
    nameIsValid,
    tagList,
  }
}

type WorkspaceForm = ReturnType<typeof useWorkspaceForm>

/** Shows a refused save on the form: a taken name beside the name, anything else as `failure`.
 * False, narrowing to the saved workspace, when it went through. */
export function showSaveError(
  form: WorkspaceForm,
  result: { workspace: Workspace } | { error: string },
  failure: string
): result is { error: string } {
  if (!('error' in result)) return false
  if (result.error === 'DUPLICATE_NAME') form.setNameError(DUPLICATE_NAME)
  else form.setError(failure)
  return true
}

interface WorkspaceDialogProps extends Pick<FieldsProps, 'form' | 'placeholders'> {
  title: string
  submitLabel: string
  onSubmit: () => Promise<void>
  onClose: () => void
}

/** The modal Create and Edit share: the fields, Cancel, and the submit action. */
export function WorkspaceDialog({
  title,
  submitLabel,
  onSubmit,
  onClose,
  ...fields
}: WorkspaceDialogProps): JSX.Element {
  const submit = {
    label: submitLabel,
    tone: 'primary' as const,
    submit: true,
    disabled: !!fields.form.nameError,
    onSelect: onSubmit,
  }
  return (
    <Dialog
      title={title}
      onDismiss={onClose}
      actions={[{ label: 'Cancel', onSelect: onClose }, submit]}
    >
      <WorkspaceFields {...fields} />
    </Dialog>
  )
}

interface FieldsProps {
  form: WorkspaceForm
  /** Example values shown in the empty fields of a new workspace. */
  placeholders?: { name: string; folderPath: string; tags: string }
}

/** Name, folder, colour and tags, in the dialog's field styles. */
function WorkspaceFields({ form, placeholders }: FieldsProps): JSX.Element {
  return (
    <>
      <NameField form={form} placeholder={placeholders?.name} />
      <FolderField form={form} placeholder={placeholders?.folderPath} />
      <ColorField form={form} />
      <div className="dialog__field">
        <label className="dialog__label">Tags (comma-separated)</label>
        <input
          className="dialog__input"
          value={form.draft.tags}
          onChange={(e) => form.update({ tags: e.target.value })}
          placeholder={placeholders?.tags}
        />
      </div>
      {form.error && <p className="dialog__error">{form.error}</p>}
    </>
  )
}

interface FieldProps {
  form: WorkspaceForm
  placeholder?: string
}

function NameField({ form, placeholder }: FieldProps): JSX.Element {
  return (
    <div className="dialog__field">
      <label className="dialog__label">Name *</label>
      <input
        className={`dialog__input${form.nameError ? ' dialog__input--error' : ''}`}
        value={form.draft.name}
        onChange={(e) => {
          form.update({ name: e.target.value })
          form.setNameError('')
        }}
        onBlur={() => form.nameIsValid()}
        placeholder={placeholder}
        autoFocus
      />
      {form.nameError && <span className="dialog__error">{form.nameError}</span>}
    </div>
  )
}

function FolderField({ form, placeholder }: FieldProps): JSX.Element {
  const browse = async (): Promise<void> => {
    const result = await window.electronAPI.dialog.openDirectory()
    if ('filePath' in result) form.update({ folderPath: result.filePath })
  }
  return (
    <div className="dialog__field">
      <label className="dialog__label">Folder</label>
      <div className="dialog__row">
        <input
          className="dialog__input"
          value={form.draft.folderPath}
          onChange={(e) => form.update({ folderPath: e.target.value })}
          placeholder={placeholder}
        />
        <Button onClick={browse}>Browse</Button>
      </div>
    </div>
  )
}

function ColorField({ form }: { form: WorkspaceForm }): JSX.Element {
  return (
    <div className="dialog__field">
      <label className="dialog__label">Color</label>
      <div className="dialog__colors">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`dialog__color-swatch${form.draft.color === c ? ' dialog__color-swatch--selected' : ''}`}
            style={{ backgroundColor: c }}
            onClick={() => form.update({ color: c })}
          />
        ))}
      </div>
    </div>
  )
}
