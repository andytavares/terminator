import React, { useState, useCallback } from 'react'
import './git-integration.css'
import { useGitStore } from '../stores/git.store'
import { useGitStatus } from '../hooks/useGitStatus'
import { StagingArea } from './StagingArea'
import { FileDiffView } from './FileDiffView'
import { PrDialog } from './PrDialog'
import type { FileDiff, PullRequest } from '../schemas/git.schema'

interface Props {
  repoRoot: string | null
}

export function GitFullView({ repoRoot }: Props): JSX.Element {
  useGitStatus(repoRoot)

  const { status, selectedFile, diffCache, setSelectedFile, setDiff, setLoading } = useGitStore()
  const [commitMessage, setCommitMessage] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [showPrDialog, setShowPrDialog] = useState(false)
  const [existingPr, setExistingPr] = useState<PullRequest | null>(null)
  const [commitError, setCommitError] = useState<string | null>(null)

  const selectedDiff: FileDiff | null = selectedFile ? (diffCache.get(selectedFile) ?? null) : null

  const handleFileSelect = useCallback(
    async (path: string, staged: boolean) => {
      if (!repoRoot) return
      setSelectedFile(path)
      if (!diffCache.has(path)) {
        setLoading(true)
        try {
          const result = (await window.electronAPI.git.diffFile(repoRoot, path, staged)) as
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
  const charCount = commitMessage.length
  const showCharCount = charCount > 50

  const handleCommit = useCallback(async () => {
    if (!canCommit || !repoRoot) return
    setIsCommitting(true)
    setCommitError(null)
    try {
      const result = (await window.electronAPI.git.commit(repoRoot, commitMessage.trim())) as
        | { commitHash: string }
        | { error: string }
      if ('error' in result) {
        const msgs: Record<string, string> = {
          NOTHING_TO_COMMIT: 'Nothing staged to commit. Stage at least one file first.',
          EMPTY_MESSAGE: 'Commit message cannot be empty.',
        }
        setCommitError(msgs[result.error] ?? result.error)
      } else {
        setCommitMessage('')
      }
    } finally {
      setIsCommitting(false)
    }
  }, [repoRoot, commitMessage, canCommit])

  const handleOpenPr = useCallback(async () => {
    if (!repoRoot) return
    const prResult = (await window.electronAPI.git.prStatus(repoRoot)) as
      | { pr: PullRequest | null }
      | { error: string }
    const pr = 'pr' in prResult ? prResult.pr : null
    setExistingPr(pr)
    setShowPrDialog(true)
  }, [repoRoot])

  const handleCommitAndPush = useCallback(async () => {
    if (!canCommit || !repoRoot) return
    setIsCommitting(true)
    setCommitError(null)
    try {
      const result = (await window.electronAPI.git.commit(repoRoot, commitMessage.trim())) as
        | { commitHash: string }
        | { error: string }
      if ('error' in result) {
        const msgs: Record<string, string> = {
          NOTHING_TO_COMMIT: 'Nothing staged to commit.',
          EMPTY_MESSAGE: 'Commit message cannot be empty.',
        }
        setCommitError(msgs[result.error] ?? result.error)
        return
      }
      setCommitMessage('')
      setIsCommitting(false)
      setIsPushing(true)
      const pushResult = (await window.electronAPI.git.push(repoRoot)) as
        | { success: true }
        | { error: string }
      if ('error' in pushResult) {
        const msgs: Record<string, string> = {
          NO_UPSTREAM: 'Committed but push failed — no upstream branch set.',
          REJECTED: 'Committed but push rejected — pull changes first.',
        }
        setCommitError(msgs[pushResult.error] ?? pushResult.error)
      }
    } finally {
      setIsCommitting(false)
      setIsPushing(false)
    }
  }, [repoRoot, commitMessage, canCommit])

  const handlePrCreated = useCallback((pr: PullRequest) => {
    setShowPrDialog(false)
    window.dispatchEvent(new CustomEvent('git:pr-created', { detail: { pr } }))
  }, [])

  if (!repoRoot) {
    return <div className="git-full-view git-full-view--empty">No project selected.</div>
  }

  return (
    <div className="git-full-view">
      {/* Left: diff / code view */}
      <div className="git-full-view__diff-pane">
        <FileDiffView diff={selectedDiff} />
      </div>

      {/* Right: changes list + commit */}
      <div className="git-full-view__changes-pane">
        <div className="git-full-view__staging">
          <StagingArea repoRoot={repoRoot} onFileSelect={handleFileSelect} />
        </div>

        <div className="git-full-view__commit-section">
          <textarea
            className="git-view__commit-message"
            placeholder="Commit message…"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            rows={3}
          />
          {showCharCount && (
            <span
              className={`git-view__char-count${charCount > 72 ? ' git-view__char-count--warn' : ''}`}
            >
              {charCount} chars
            </span>
          )}
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
              <button className="git-view__btn git-view__btn--secondary" onClick={handleOpenPr}>
                Open PR
              </button>
              <button
                className="git-view__btn git-view__btn--secondary"
                onClick={handleCommit}
                disabled={!canCommit || isCommitting || isPushing}
              >
                {isCommitting ? '⟳ Committing…' : 'Commit'}
              </button>
              <button
                className="git-view__btn git-view__btn--primary"
                onClick={handleCommitAndPush}
                disabled={!canCommit || isCommitting || isPushing}
              >
                {isPushing ? '⟳ Pushing…' : isCommitting ? '⟳ Committing…' : 'Commit & Push'}
              </button>
            </div>
          </div>
        </div>
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
