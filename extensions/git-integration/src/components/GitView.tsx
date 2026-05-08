import React, { useState, useCallback } from 'react'
import './git-integration.css'
import { useGitStore } from '../stores/git.store'
import { StagingArea } from './StagingArea'
import { FileDiffView } from './FileDiffView'
import { PrDialog } from './PrDialog'
import type { FileDiff, PullRequest } from '../schemas/git.schema'

interface GitViewProps {
  repoRoot: string
}

export function GitView({ repoRoot }: GitViewProps): JSX.Element {
  const { status, selectedFile, diffCache, setSelectedFile, setDiff, setLoading } = useGitStore()
  const [commitMessage, setCommitMessage] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const [showPrDialog, setShowPrDialog] = useState(false)
  const [existingPr, setExistingPr] = useState<PullRequest | null>(null)
  const [commitError, setCommitError] = useState<string | null>(null)

  const selectedDiff: FileDiff | null = selectedFile ? diffCache.get(selectedFile) ?? null : null

  const handleFileSelect = useCallback(
    async (path: string, staged: boolean) => {
      setSelectedFile(path)
      if (!diffCache.has(path)) {
        setLoading(true)
        try {
          const result = await window.electronAPI.git.diffFile(repoRoot, path, staged) as
            | { diff: FileDiff }
            | { error: string }
          if ('diff' in result) setDiff(path, result.diff)
        } finally {
          setLoading(false)
        }
      }
    },
    [repoRoot, diffCache, setSelectedFile, setDiff, setLoading]
  )

  const stagedFiles = status?.files.filter((f) => f.staged) ?? []
  const canCommit = stagedFiles.length > 0 && commitMessage.trim().length > 0

  const handleCommit = useCallback(async () => {
    if (!canCommit) return
    setIsCommitting(true)
    setCommitError(null)
    try {
      const result = await window.electronAPI.git.commit(
        repoRoot,
        commitMessage.trim()
      ) as { commitHash: string } | { error: string }

      if ('error' in result) {
        const errorMessages: Record<string, string> = {
          NOTHING_TO_COMMIT: 'Nothing staged to commit. Stage at least one file first.',
          EMPTY_MESSAGE: 'Commit message cannot be empty.',
        }
        setCommitError(errorMessages[result.error] ?? result.error)
      } else {
        setCommitMessage('')
        // Status refresh is triggered by fs.watch in activate()
      }
    } finally {
      setIsCommitting(false)
    }
  }, [repoRoot, commitMessage, canCommit])

  const handleOpenPr = useCallback(async () => {
    const prResult = await window.electronAPI.git.prStatus(repoRoot) as
      | { pr: PullRequest | null }
      | { error: string }
    const pr = 'pr' in prResult ? prResult.pr : null
    setExistingPr(pr)
    setShowPrDialog(true)
  }, [repoRoot])

  const handlePrCreated = useCallback((pr: PullRequest) => {
    setShowPrDialog(false)
    const msg = pr.isDraft ? `Draft PR created: ${pr.url}` : `PR created: ${pr.url}`
    // Toast via electronAPI if available; extension's api.notifications handles the actual toast
    window.dispatchEvent(new CustomEvent('git:pr-created', { detail: { pr, msg } }))
  }, [])

  return (
    <div className="git-view">
      <div className="git-view__left">
        <StagingArea repoRoot={repoRoot} onFileSelect={handleFileSelect} />

        <div className="git-view__commit-section">
          <textarea
            className="git-view__commit-message"
            placeholder="Commit message…"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            rows={3}
          />
          {commitError && <div className="git-view__commit-error">{commitError}</div>}
          <div className="git-view__commit-actions">
            <div className="git-view__commit-hint">
              {stagedFiles.length === 0 && (
                <span className="git-view__hint-text">Stage at least one file to commit</span>
              )}
              {stagedFiles.length > 0 && !commitMessage.trim() && (
                <span className="git-view__hint-text">Enter a commit message</span>
              )}
            </div>
            <div className="git-view__buttons">
              <button
                className="git-view__btn git-view__btn--secondary"
                onClick={handleOpenPr}
              >
                Open Pull Request
              </button>
              <button
                className="git-view__btn git-view__btn--primary"
                onClick={handleCommit}
                disabled={!canCommit || isCommitting}
                title={!canCommit ? 'Stage files and enter a commit message to commit' : undefined}
              >
                {isCommitting ? 'Committing…' : 'Commit'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="git-view__right">
        <FileDiffView diff={selectedDiff} />
      </div>

      {showPrDialog && status && (
        <PrDialog
          repoRoot={repoRoot}
          branch={status.branch}
          existingPr={existingPr}
          onClose={() => setShowPrDialog(false)}
          onCreated={handlePrCreated}
        />
      )}
    </div>
  )
}
