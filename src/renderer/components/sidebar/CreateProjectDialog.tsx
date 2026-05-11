import React, { useState, useEffect } from 'react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSettingsStore } from '../../stores/settings.store'
import type { Branch } from '../../../shared/types/index'
import './Dialog.css'

interface Props {
  workspaceId: string
  onClose: () => void
}

export function CreateProjectDialog({ workspaceId, onClose }: Props): JSX.Element {
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState('')
  const [isWorktreeMode, setIsWorktreeMode] = useState(false)
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = useState('')
  const [isNewBranch, setIsNewBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [worktreePath, setWorktreePath] = useState('')
  const [gitRoot, setGitRoot] = useState<string | null>(null)
  const [error, setError] = useState('')

  const { createProject, projectsByWorkspaceId, workspaces } = useWorkspaceStore()
  const { resolveSettings } = useSettingsStore()
  const workspace = workspaces.find((w) => w.id === workspaceId)
  const worktreeBaseDir = resolveSettings(workspaceId).git.worktreeBaseDir || undefined

  useEffect(() => {
    if (!workspace?.folderPath) return
    window.electronAPI.git.isRepo(workspace.folderPath).then((info) => {
      if (info.isRepo && info.root) {
        setGitRoot(info.root)
        window.electronAPI.git.listBranches(info.root).then((r) => {
          setBranches(r.branches)
          const current = r.branches.find((b) => b.isCurrent && !b.isRemote)
          if (current) setSelectedBranch(current.name)
        })
      }
    })
  }, [workspace?.folderPath])

  useEffect(() => {
    if (!gitRoot || !isWorktreeMode) return
    const branch = isNewBranch ? newBranchName : selectedBranch
    if (!branch) return
    window.electronAPI.git.suggestWorktreePath(gitRoot, branch, worktreeBaseDir).then((r) => {
      setWorktreePath(r.path)
    })
  }, [gitRoot, isWorktreeMode, selectedBranch, isNewBranch, newBranchName, worktreeBaseDir])

  function validateName(value: string): string {
    if (!value.trim()) return 'Name is required'
    if (value.length > 100) return 'Name must be 100 characters or less'
    const existing = projectsByWorkspaceId.get(workspaceId) ?? []
    if (existing.some((p) => p.name.toLowerCase() === value.toLowerCase())) {
      return 'A project with this name already exists in this workspace'
    }
    return ''
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const nameErr = validateName(name)
    if (nameErr) {
      setNameError(nameErr)
      return
    }

    if (isWorktreeMode && gitRoot) {
      const branch = isNewBranch ? newBranchName.trim() : selectedBranch
      if (!branch) {
        setError('Select or enter a branch name')
        return
      }
      const wt = await window.electronAPI.git.createWorktree({
        repoRoot: gitRoot,
        worktreePath,
        branch,
        isNewBranch,
      })
      if ('error' in wt) {
        setError(`Worktree error: ${wt.error}`)
        return
      }

      const result = await createProject({
        workspaceId,
        name: name.trim(),
        gitBranch: branch,
        worktreePath,
        isWorktree: true,
      })
      if ('error' in result) {
        if (result.error === 'DUPLICATE_NAME')
          setNameError('A project with this name already exists')
        else setError('Failed to create project')
        return
      }
    } else {
      const result = await createProject({ workspaceId, name: name.trim() })
      if ('error' in result) {
        if (result.error === 'DUPLICATE_NAME')
          setNameError('A project with this name already exists')
        return
      }
    }
    onClose()
  }

  const branchName = isNewBranch ? newBranchName : selectedBranch
  const localBranches = branches.filter((b) => !b.isRemote)

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="dialog__title">Create Project</h2>
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
              placeholder="My Project"
              autoFocus
            />
            {nameError && <span className="dialog__error">{nameError}</span>}
          </div>

          {gitRoot && (
            <div className="dialog__field">
              <label className="dialog__label dialog__label--toggle">
                <input
                  type="checkbox"
                  checked={isWorktreeMode}
                  onChange={(e) => setIsWorktreeMode(e.target.checked)}
                />
                <span>Create as git worktree</span>
              </label>
            </div>
          )}

          {isWorktreeMode && gitRoot && (
            <>
              <div className="dialog__field">
                <label className="dialog__label">Branch</label>
                <div className="dialog__row">
                  <select
                    className="dialog__input"
                    value={isNewBranch ? '__new__' : selectedBranch}
                    onChange={(e) => {
                      if (e.target.value === '__new__') {
                        setIsNewBranch(true)
                      } else {
                        setIsNewBranch(false)
                        setSelectedBranch(e.target.value)
                      }
                    }}
                  >
                    {localBranches.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name}
                        {b.isCurrent ? ' (current)' : ''}
                      </option>
                    ))}
                    <option value="__new__">+ New branch…</option>
                  </select>
                </div>
              </div>

              {isNewBranch && (
                <div className="dialog__field">
                  <label className="dialog__label">New branch name</label>
                  <input
                    className="dialog__input"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder="feature/my-feature"
                  />
                </div>
              )}

              <div className="dialog__field">
                <label className="dialog__label">Worktree path</label>
                <div className="dialog__row">
                  <input
                    className="dialog__input"
                    value={worktreePath}
                    onChange={(e) => setWorktreePath(e.target.value)}
                    placeholder={
                      branchName ? `Suggested based on "${branchName}"` : '/path/to/worktree'
                    }
                  />
                </div>
                <span className="dialog__hint">Directory will be created by git</span>
              </div>
            </>
          )}

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
