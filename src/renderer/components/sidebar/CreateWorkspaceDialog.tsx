import React, { useState } from 'react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { WORKSPACE_PRESET_COLORS as PRESET_COLORS } from './workspace-colors'
import './Dialog.css'

interface Props {
  onClose: () => void
}

export function CreateWorkspaceDialog({ onClose }: Props): JSX.Element {
  const [name, setName] = useState('')
  const [folderPath, setFolderPath] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [tags, setTags] = useState('')
  const [error, setError] = useState('')
  const [nameError, setNameError] = useState('')
  const { createWorkspace, createProject, workspaces } = useWorkspaceStore()

  function validateName(value: string): string {
    if (!value.trim()) return 'Name is required'
    if (value.length > 100) return 'Name must be 100 characters or less'
    if (workspaces.some((w) => w.name.toLowerCase() === value.toLowerCase())) {
      return 'A workspace with this name already exists'
    }
    return ''
  }

  function handleNameBlur(): void {
    setNameError(validateName(name))
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

    const result = await createWorkspace({ name: name.trim(), folderPath, color, tags: tagList })
    if ('error' in result) {
      if (result.error === 'DUPLICATE_NAME')
        setNameError('A workspace with this name already exists')
      else setError('Failed to create workspace')
      return
    }

    if (folderPath && 'workspace' in result) {
      const wsId = result.workspace.id
      const gitInfo = await window.electronAPI.git.isRepo(folderPath)
      if (gitInfo.isRepo) {
        const root = gitInfo.root ?? folderPath
        const branchInfo = await window.electronAPI.git.currentBranch(root)
        const branch = 'branch' in branchInfo ? branchInfo.branch : 'main'
        await createProject({
          workspaceId: wsId,
          name: branch,
          gitBranch: branch,
          worktreePath: root,
          isWorktree: false,
        })
      }
    }

    onClose()
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="dialog__title">Create Workspace</h2>
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
              onBlur={handleNameBlur}
              placeholder="My Workspace"
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
                placeholder="/path/to/folder"
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
              placeholder="frontend, work, personal"
            />
          </div>

          {error && <p className="dialog__error">{error}</p>}

          <div className="dialog__actions">
            <button type="button" className="dialog__btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="dialog__btn-primary" disabled={!!nameError}>
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
