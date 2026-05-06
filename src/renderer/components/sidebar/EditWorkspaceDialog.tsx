import React, { useState } from 'react'
import type { Workspace } from '../../../shared/types/index'
import { useWorkspaceStore } from '../../stores/workspace.store'
import './Dialog.css'

const PRESET_COLORS = [
  '#4A90E2',
  '#7B68EE',
  '#50C878',
  '#FF6B6B',
  '#FFA500',
  '#20B2AA',
  '#FF69B4',
  '#9370DB',
  '#3CB371',
  '#DC143C',
]

interface Props {
  workspace: Workspace
  onClose: () => void
}

export function EditWorkspaceDialog({ workspace, onClose }: Props): JSX.Element {
  const [name, setName] = useState(workspace.name)
  const [folderPath, setFolderPath] = useState(workspace.folderPath)
  const [color, setColor] = useState(workspace.color)
  const [tags, setTags] = useState(workspace.tags.join(', '))
  const [nameError, setNameError] = useState('')
  const [error, setError] = useState('')
  const { updateWorkspace, workspaces } = useWorkspaceStore()

  function validateName(value: string): string {
    if (!value.trim()) return 'Name is required'
    if (value.length > 100) return 'Name must be 100 characters or less'
    if (
      value.toLowerCase() !== workspace.name.toLowerCase() &&
      workspaces.some((w) => w.name.toLowerCase() === value.toLowerCase() && w.id !== workspace.id)
    ) {
      return 'A workspace with this name already exists'
    }
    return ''
  }

  async function handleBrowse(): Promise<void> {
    const result = await window.electronAPI.dialog.openDirectory()
    if ('filePath' in result) setFolderPath(result.filePath)
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const nameErr = validateName(name)
    if (nameErr) {
      setNameError(nameErr)
      return
    }

    const tagList = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const result = await updateWorkspace({
      id: workspace.id,
      name: name.trim(),
      folderPath,
      color,
      tags: tagList,
    })
    if ('error' in result) {
      if (result.error === 'DUPLICATE_NAME')
        setNameError('A workspace with this name already exists')
      else setError('Failed to update workspace')
      return
    }
    onClose()
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="dialog__title">Edit Workspace</h2>
        <form onSubmit={handleSubmit}>
          <div className="dialog__field">
            <label className="dialog__label">Name *</label>
            <input
              className={`dialog__input${nameError ? ' dialog__input--error' : ''}`}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setNameError('')
              }}
              onBlur={() => setNameError(validateName(name))}
              autoFocus
            />
            {nameError && <span className="dialog__error">{nameError}</span>}
          </div>

          <div className="dialog__field">
            <label className="dialog__label">Folder</label>
            <div className="dialog__row">
              <input
                className="dialog__input"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
              />
              <button type="button" className="dialog__btn-secondary" onClick={handleBrowse}>
                Browse
              </button>
            </div>
          </div>

          <div className="dialog__field">
            <label className="dialog__label">Color</label>
            <div className="dialog__colors">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`dialog__color-swatch${color === c ? ' dialog__color-swatch--selected' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          <div className="dialog__field">
            <label className="dialog__label">Tags (comma-separated)</label>
            <input
              className="dialog__input"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>

          {error && <p className="dialog__error">{error}</p>}

          <div className="dialog__actions">
            <button type="button" className="dialog__btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="dialog__btn-primary" disabled={!!nameError}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
