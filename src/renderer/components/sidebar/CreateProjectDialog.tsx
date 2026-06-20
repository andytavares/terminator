import React, { useState, useEffect } from 'react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSettingsStore } from '../../stores/settings.store'
import type { Branch, WorktreeInfo } from '../../../shared/types/index'
import { BranchSelect } from './BranchSelect'
import './Dialog.css'

type BranchMode = 'existing' | 'worktree'

interface Props {
  workspaceId: string
  onClose: () => void
}

export function CreateProjectDialog({ workspaceId, onClose }: Props): JSX.Element {
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState('')
  const [branches, setBranches] = useState<Branch[]>([])
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const [selectedBranch, setSelectedBranch] = useState('')
  const [newBranchName, setNewBranchName] = useState('')
  const [isNewBranch, setIsNewBranch] = useState(false)
  const [worktreeIsNewBranch, setWorktreeIsNewBranch] = useState(true)
  const [worktreePath, setWorktreePath] = useState('')
  const [gitRoot, setGitRoot] = useState<string | null>(null)
  const [error, setError] = useState('')

  const { createProject, projectsByWorkspaceId, workspaces } = useWorkspaceStore()
  const { resolveSettings } = useSettingsStore()
  const workspace = workspaces.find((w) => w.id === workspaceId)
  const worktreeBaseDir = resolveSettings(workspaceId).git.worktreeBaseDir || undefined
  const hasNonWorktreeProject = (projectsByWorkspaceId.get(workspaceId) ?? []).some(
    (p) => !p.isWorktree
  )
  const [branchMode, setBranchMode] = useState<BranchMode>(
    hasNonWorktreeProject ? 'worktree' : 'existing'
  )

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
        window.electronAPI.git.listWorktrees(info.root).then((r) => {
          setWorktrees(r.worktrees)
        })
      }
    })
  }, [workspace?.folderPath])

  useEffect(() => {
    if (!gitRoot || branchMode !== 'worktree') return
    const branch = worktreeIsNewBranch ? newBranchName : selectedBranch
    if (!branch) {
      // Show the base directory so users can see where worktrees go by default
      setWorktreePath(worktreeBaseDir ?? `${gitRoot}/.worktrees`)
      return
    }
    window.electronAPI.git.suggestWorktreePath(gitRoot, branch, worktreeBaseDir).then((r) => {
      setWorktreePath(r.path)
    })
  }, [gitRoot, branchMode, selectedBranch, worktreeIsNewBranch, newBranchName, worktreeBaseDir])

  function validateName(value: string): string {
    if (!value.trim()) return 'Name is required'
    if (value.length > 100) return 'Name must be 100 characters or less'
    const existing = projectsByWorkspaceId.get(workspaceId) ?? []
    if (existing.some((p) => p.name.toLowerCase() === value.toLowerCase())) {
      return 'A project with this name already exists in this workspace'
    }
    return ''
  }

  function sanitizeBranchName(value: string): string {
    return (
      value
        .replace(/ /g, '-')
        // eslint-disable-next-line no-control-regex
        .replace(/[~^:?*[\\\x00-\x1f\x7f]/g, '')
        .replace(/\.\.+/g, '.')
        .replace(/^[./]+|[./]+$/g, '')
    )
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const nameErr = validateName(name)
    if (nameErr) {
      setNameError(nameErr)
      return
    }
    setError('')

    if (branchMode === 'existing' && hasNonWorktreeProject) {
      setError('A branch-based project already exists in this workspace')
      return
    }

    if (!gitRoot || branchMode === 'existing') {
      let branch = selectedBranch
      if (gitRoot && isNewBranch) {
        const branchTrimmed = newBranchName.trim()
        if (!branchTrimmed) {
          setError('Enter a branch name')
          return
        }
        const created = await window.electronAPI.git.createBranch(
          workspace!.folderPath,
          branchTrimmed
        )
        if ('error' in created) {
          setError(`Could not create branch: ${created.error}`)
          return
        }
        branch = branchTrimmed
      }
      const result = await createProject({
        workspaceId,
        name: name.trim(),
        ...(branch ? { gitBranch: branch } : {}),
      })
      if ('error' in result) {
        if (result.error === 'DUPLICATE_NAME')
          setNameError('A project with this name already exists')
        else setError('Failed to create project')
        return
      }
    } else {
      // worktree
      const branch = worktreeIsNewBranch ? newBranchName.trim() : selectedBranch
      if (!branch) {
        setError('Select or enter a branch name')
        return
      }
      const wt = await window.electronAPI.git.createWorktree({
        repoRoot: gitRoot,
        worktreePath,
        branch,
        isNewBranch: worktreeIsNewBranch,
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
    }
    onClose()
  }

  const defaultBranchName =
    branches.find((b) => b.name === 'main' && !b.isRemote)?.name ??
    branches.find((b) => b.name === 'master' && !b.isRemote)?.name ??
    null
  const localBranches = branches
    .filter((b) => !b.isRemote)
    .sort((a, b) => {
      if (a.name === defaultBranchName) return -1
      if (b.name === defaultBranchName) return 1
      return 0
    })
  const usedBranchNames = new Set(worktrees.map((w) => w.branch))
  const availableWorktreeBranches = localBranches.filter((b) => !usedBranchNames.has(b.name))
  const worktreeBranchName = worktreeIsNewBranch ? newBranchName : selectedBranch

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
              <label className="dialog__label">Branch</label>
              <div className="dialog__segment">
                <button
                  type="button"
                  className={`dialog__segment-btn${branchMode === 'existing' ? ' dialog__segment-btn--active' : ''}${hasNonWorktreeProject ? ' dialog__segment-btn--disabled' : ''}`}
                  onClick={() => !hasNonWorktreeProject && setBranchMode('existing')}
                  disabled={hasNonWorktreeProject}
                  title={
                    hasNonWorktreeProject
                      ? 'A branch-based project already exists in this workspace'
                      : undefined
                  }
                >
                  Branch
                </button>
                <button
                  type="button"
                  className={`dialog__segment-btn${branchMode === 'worktree' ? ' dialog__segment-btn--active' : ''}`}
                  onClick={() => setBranchMode('worktree')}
                >
                  Worktree
                </button>
              </div>
            </div>
          )}

          {gitRoot && branchMode === 'existing' && (
            <div className="dialog__field">
              <BranchSelect
                branches={localBranches}
                value={selectedBranch}
                onChange={(b) => {
                  setIsNewBranch(false)
                  setSelectedBranch(b)
                }}
                newBranchLabel="+ New branch…"
                onNewBranch={() => setIsNewBranch(true)}
                isNewSelected={isNewBranch}
              />
            </div>
          )}

          {gitRoot && branchMode === 'existing' && isNewBranch && (
            <div className="dialog__field">
              <input
                className="dialog__input"
                value={newBranchName}
                onChange={(e) => setNewBranchName(sanitizeBranchName(e.target.value))}
                placeholder="feature/my-feature"
                autoFocus
              />
            </div>
          )}

          {gitRoot && branchMode === 'worktree' && (
            <>
              <div className="dialog__field">
                <label className="dialog__label">Branch</label>
                <BranchSelect
                  branches={availableWorktreeBranches}
                  value={selectedBranch}
                  onChange={(b) => {
                    setWorktreeIsNewBranch(false)
                    setSelectedBranch(b)
                  }}
                  newBranchLabel="+ New branch…"
                  onNewBranch={() => setWorktreeIsNewBranch(true)}
                  isNewSelected={worktreeIsNewBranch}
                />
              </div>

              {worktreeIsNewBranch && (
                <div className="dialog__field">
                  <label className="dialog__label">New branch name</label>
                  <input
                    className="dialog__input"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(sanitizeBranchName(e.target.value))}
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
                      worktreeBranchName
                        ? `Suggested based on "${worktreeBranchName}"`
                        : '/path/to/worktree'
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
