import React, { useCallback, useState } from 'react'
import { useGitStore } from '../stores/git.store'
import { useGitStatus } from '../hooks/useGitStatus'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { StagingArea } from './StagingArea'
import { PrDialog } from './PrDialog'
import './git-integration.css'
import type { FileDiff, PullRequest } from '../schemas/git.schema'
import { gitAPI } from '../api/git'

interface Props {
  repoRoot: string | null
  onClose: () => void
}

export function GitSidebarPanel({ repoRoot, onClose }: Props): JSX.Element {
  useGitStatus(repoRoot)
  const { status, setSelectedFile, setDiff, setView } = useGitStore()
  const { setActiveProjectTab } = useExtensionRegistry()

  const [commitMessage, setCommitMessage] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [showPrDialog, setShowPrDialog] = useState(false)
  const [existingPr, setExistingPr] = useState<PullRequest | null>(null)

  const stagedFiles = status?.files.filter((f) => f.staged) ?? []
  const canCommit = stagedFiles.length > 0 && commitMessage.trim().length > 0

  const handleFileSelect = useCallback(
    (path: string, staged: boolean) => {
      setSelectedFile(path)
      setActiveProjectTab('git')
      if (repoRoot) {
        void gitAPI.diffFile(repoRoot, path, staged).then((result) => {
          const r = result as { diff: FileDiff } | { error: string }
          if ('diff' in r) setDiff(path, r.diff)
        })
      }
    },
    [repoRoot, setSelectedFile, setActiveProjectTab, setDiff]
  )

  const handleCommit = useCallback(async () => {
    if (!canCommit || !repoRoot) return
    setIsCommitting(true)
    setCommitError(null)
    try {
      const result = await gitAPI.commit(repoRoot, commitMessage.trim(), false, false)
      if ('error' in result) {
        const msgs: Record<string, string> = {
          NOTHING_TO_COMMIT: 'Nothing staged to commit.',
          EMPTY_MESSAGE: 'Commit message cannot be empty.',
          TIMEOUT: 'Commit timed out.',
          HOOK_FAILED: 'Pre-commit hooks failed.',
        }
        setCommitError(msgs[result.error] ?? result.error)
      } else {
        setCommitMessage('')
        setCommitError(null)
      }
    } finally {
      setIsCommitting(false)
    }
  }, [repoRoot, commitMessage, canCommit])

  const handleCommitAndPush = useCallback(async () => {
    if (!canCommit || !repoRoot) return
    setIsCommitting(true)
    setCommitError(null)
    try {
      const result = await gitAPI.commit(repoRoot, commitMessage.trim(), false, false)
      if ('error' in result) {
        const msgs: Record<string, string> = {
          NOTHING_TO_COMMIT: 'Nothing staged to commit.',
          EMPTY_MESSAGE: 'Commit message cannot be empty.',
          TIMEOUT: 'Commit timed out.',
          HOOK_FAILED: 'Pre-commit hooks failed.',
        }
        setCommitError(msgs[result.error] ?? result.error)
        return
      }
      setCommitMessage('')
      setIsCommitting(false)
      setIsPushing(true)
      const pushResult = (await gitAPI.push(repoRoot)) as { success: true } | { error: string }
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

  const handleOpenPr = useCallback(async () => {
    if (!repoRoot) return
    const prResult = (await gitAPI.prStatus(repoRoot)) as
      | { pr: PullRequest | null }
      | { error: string }
    const pr = 'pr' in prResult ? prResult.pr : null
    setExistingPr(pr)
    setShowPrDialog(true)
  }, [repoRoot])

  const handlePrCreated = useCallback((pr: PullRequest) => {
    setShowPrDialog(false)
    window.dispatchEvent(new CustomEvent('git:pr-created', { detail: { pr } }))
  }, [])

  return (
    <div className="git-sidebar">
      <div className="git-sidebar__header">
        {status ? (
          <span className="git-sidebar__branch">⎇ {status.branch}</span>
        ) : (
          <span className="git-sidebar__branch">Git</span>
        )}
        <button className="git-sidebar__close-btn" onClick={onClose} title="Close">
          ×
        </button>
      </div>

      {status?.hasConflicts && (
        <button
          className="git-sidebar__resolve-conflicts-btn"
          onClick={() => setView('merge-flow')}
          data-testid="resolve-conflicts-btn"
        >
          Resolve conflicts →
        </button>
      )}

      {!status ? (
        <div className="git-sidebar__file-list">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className="skeleton skeleton--row" />
          ))}
        </div>
      ) : (
        <StagingArea repoRoot={repoRoot!} onFileSelect={handleFileSelect} />
      )}

      <div className="git-full-view__commit-section">
        <textarea
          className="git-view__commit-message"
          placeholder="Commit message…"
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          rows={3}
        />
        {commitError && (
          <div className="git-view__commit-error">
            <span className="git-view__commit-error-msg">{commitError}</span>
          </div>
        )}
        <div className="git-view__buttons">
          <button
            className="git-view__btn git-view__btn--secondary"
            onClick={() => void handleOpenPr()}
          >
            Open PR
          </button>
          <button
            className="git-view__btn git-view__btn--secondary"
            onClick={() => void handleCommit()}
            disabled={!canCommit || isCommitting || isPushing}
          >
            {isCommitting ? '⟳ Committing…' : 'Commit'}
          </button>
          <button
            className="git-view__btn git-view__btn--primary"
            onClick={() => void handleCommitAndPush()}
            disabled={!canCommit || isCommitting || isPushing}
          >
            {isPushing ? '⟳ Pushing…' : 'Commit & Push'}
          </button>
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
