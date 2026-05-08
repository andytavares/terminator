import React, { useState, useEffect } from 'react'
import type { PullRequest } from '../../../../src/shared/schemas/git.schema'

interface PrDialogProps {
  repoRoot: string
  branch: string
  existingPr: PullRequest | null
  onClose: () => void
  onCreated: (pr: PullRequest) => void
}

export function PrDialog({ repoRoot, branch, existingPr, onClose, onCreated }: PrDialogProps): JSX.Element {
  const [title, setTitle] = useState(branch)
  const [body, setBody] = useState('')
  const [base, setBase] = useState('main')
  const [isDraft, setIsDraft] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDefaultBranch = branch === 'main' || branch === 'master'

  useEffect(() => {
    // Pre-fill title from branch name and body from recent commits would be loaded here
    setTitle(branch.replace(/^(feat|fix|chore|docs|refactor)\//i, '').replace(/-/g, ' '))
  }, [branch])

  const handleCreate = async (): Promise<void> => {
    if (!title.trim()) {
      setError('Title is required')
      return
    }
    setIsCreating(true)
    setError(null)
    try {
      const result = await window.electronAPI.git.prCreate({
        repoRoot,
        title: title.trim(),
        body,
        base,
        isDraft,
      }) as { pr: PullRequest } | { error: string }

      if ('error' in result) {
        setError(result.error)
      } else {
        onCreated(result.pr)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="pr-dialog-overlay">
      <div className="pr-dialog" role="dialog" aria-modal="true" aria-label="Create Pull Request">
        <div className="pr-dialog__header">
          <h2>Open Pull Request</h2>
          <button className="pr-dialog__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {existingPr && (
          <div className="pr-dialog__existing-banner">
            A PR already exists for this branch:{' '}
            <a href={existingPr.url} target="_blank" rel="noopener noreferrer">
              #{existingPr.number}: {existingPr.title}
            </a>
          </div>
        )}

        {isDefaultBranch && (
          <div className="pr-dialog__warning-banner">
            Warning: You are creating a PR from the default branch ({branch}). This is unusual.
          </div>
        )}

        <div className="pr-dialog__body">
          <label className="pr-dialog__label">
            Title
            <input
              className="pr-dialog__input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Pull request title"
            />
          </label>

          <label className="pr-dialog__label">
            Description
            <textarea
              className="pr-dialog__textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe your changes…"
              rows={6}
            />
          </label>

          <label className="pr-dialog__label">
            Base branch
            <input
              className="pr-dialog__input"
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder="main"
            />
          </label>

          <label className="pr-dialog__checkbox-label">
            <input
              type="checkbox"
              checked={isDraft}
              onChange={(e) => setIsDraft(e.target.checked)}
            />
            Create as Draft
          </label>
        </div>

        {error && <div className="pr-dialog__error">{error}</div>}

        <div className="pr-dialog__actions">
          <button className="pr-dialog__cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="pr-dialog__create-btn"
            onClick={handleCreate}
            disabled={isCreating || !title.trim() || !!existingPr}
          >
            {isCreating ? 'Creating…' : isDraft ? 'Create Draft PR' : 'Create PR'}
          </button>
        </div>
      </div>
    </div>
  )
}
