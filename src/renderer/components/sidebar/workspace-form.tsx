import React, { useState } from 'react'
import { Button } from '@terminator/extension-ui'
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

export const DUPLICATE_NAME = 'A workspace with this name already exists'

/** The draft, its errors, and the checks a submit runs first. */
export function useWorkspaceForm(initial: WorkspaceDraft, nameTaken: (name: string) => boolean) {
  const [draft, setDraft] = useState(initial)
  const [nameError, setNameError] = useState('')
  const [error, setError] = useState('')

  const validateName = (value: string): string => {
    if (!value.trim()) return 'Name is required'
    if (value.length > 100) return 'Name must be 100 characters or less'
    return nameTaken(value) ? DUPLICATE_NAME : ''
  }

  /** False, with the reason shown, when the name cannot be submitted. */
  const nameIsValid = (): boolean => {
    const reason = validateName(draft.name)
    setNameError(reason)
    return reason === ''
  }

  const update = (patch: Partial<WorkspaceDraft>): void => setDraft((d) => ({ ...d, ...patch }))
  const tagList = (): string[] =>
    draft.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

  return { draft, update, nameError, setNameError, error, setError, nameIsValid, tagList }
}

export type WorkspaceForm = ReturnType<typeof useWorkspaceForm>

interface FieldsProps {
  form: WorkspaceForm
  /** Example values shown in the empty fields of a new workspace. */
  placeholders?: { name: string; folderPath: string; tags: string }
}

/** Name, folder, colour and tags, in the dialog's field styles. */
export function WorkspaceFields({ form, placeholders }: FieldsProps): JSX.Element {
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
