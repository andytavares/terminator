import React, { useCallback, useState } from 'react'
import { ChevronDown, GitBranch } from 'lucide-react'
import { Popover } from '@terminator/extension-ui'
import { useGitStore } from '../stores/git.store'
import { useGitStatus } from '../hooks/useGitStatus'
import { StagingArea } from './StagingArea'
import { PrDialog } from './PrDialog'
import './git-integration.css'
import type { FileDiff, PullRequest } from '../schemas/git.schema'
import { gitAPI } from '../api/git'

/**
 * "3 ahead of main · nothing to pull" — the two facts you most want before
 * committing, which the header carried neither of.
 */
export function trackingLine(status: {
  ahead?: number
  behind?: number
  upstream?: string | null
}): string {
  const ahead = status.ahead ?? 0
  const behind = status.behind ?? 0
  if (!status.upstream) return 'No upstream branch yet'
  const parts: string[] = []
  parts.push(ahead === 0 ? 'nothing to push' : `${ahead} ahead`)
  parts.push(behind === 0 ? 'nothing to pull' : `${behind} behind`)
  return parts.join(' · ')
}

/**
 * Why the commit button is unavailable.
 *
 * A disabled control that does not say what would enable it leaves the reader
 * guessing, which is exactly what three greyed-out buttons did.
 */
export function whyCannotCommit(stagedCount: number, message: string): string {
  if (stagedCount === 0 && message.trim() === '') {
    return 'Stage a file and describe the change to commit.'
  }
  if (stagedCount === 0) return 'Stage at least one file to commit.'
  return 'Describe the change to commit.'
}

interface Props {
  repoRoot: string | null
  onClose: () => void
}

export function GitSidebarPanel({ repoRoot, onClose: _onClose }: Props): JSX.Element {
  useGitStatus(repoRoot)
  const { status, setSelectedFile, setDiff } = useGitStore()

  const [commitMessage, setCommitMessage] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [showPrDialog, setShowPrDialog] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [existingPr, setExistingPr] = useState<PullRequest | null>(null)

  const stagedFiles = status?.files.filter((f) => f.staged) ?? []
  const canCommit = stagedFiles.length > 0 && commitMessage.trim().length > 0

  const handleFileSelect = useCallback(
    (path: string, staged: boolean) => {
      setSelectedFile(path)
      // Bring the Git project tab forward so the diff this selection produces is
      // actually on screen. Goes through the extension's own main-process
      // handler: this panel is an isolated webview and cannot reach the host's
      // store directly (and the import that used to try reached a copy).
      void window.electronAPI.extensionBridge.invoke('git:focus-project-tab', { tabId: 'git' })
      if (repoRoot) {
        void gitAPI.diffFile(repoRoot, path, staged).then((result) => {
          const r = result as { diff: FileDiff } | { error: string }
          if ('diff' in r) setDiff(path, r.diff)
        })
      }
    },
    [repoRoot, setSelectedFile, setDiff]
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
          <>
            <span className="git-sidebar__branch">
              <GitBranch aria-hidden="true" /> {status.branch}
            </span>
            {/* Ahead/behind: the two facts you most want before committing, and
                the header carried neither. */}
            <span className="git-sidebar__tracking">{trackingLine(status)}</span>
          </>
        ) : (
          <span className="git-sidebar__branch">Git</span>
        )}
      </div>

      {status?.hasConflicts && (
        <button
          className="git-sidebar__resolve-conflicts-btn"
          onClick={() =>
            void window.electronAPI.extensionBridge.invoke('git:request-merge-flow', { repoRoot })
          }
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
        {/* Was three buttons of near-equal weight, two of them disabled and
            hard to tell apart from the one that was not. One primary now, with
            the alternates behind its caret. */}
        <div className="git-view__buttons">
          <button
            className="git-view__btn git-view__btn--primary git-view__btn--grow"
            onClick={() => void handleCommitAndPush()}
            disabled={!canCommit || isCommitting || isPushing}
          >
            {isPushing ? 'Pushing…' : isCommitting ? 'Committing…' : 'Commit & push'}
          </button>
          <div className="git-view__more">
            <button
              type="button"
              className="git-view__btn git-view__btn--caret"
              aria-label="Other commit actions"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <ChevronDown aria-hidden="true" />
            </button>
            {moreOpen && (
              <Popover label="Other commit actions" onDismiss={() => setMoreOpen(false)}>
                <button
                  type="button"
                  className="git-view__menu-item"
                  disabled={!canCommit || isCommitting || isPushing}
                  onClick={() => {
                    setMoreOpen(false)
                    void handleCommit()
                  }}
                >
                  Commit without pushing
                </button>
                <button
                  type="button"
                  className="git-view__menu-item"
                  onClick={() => {
                    setMoreOpen(false)
                    void handleOpenPr()
                  }}
                >
                  Open a pull request
                </button>
              </Popover>
            )}
          </div>
        </div>
        {/* A disabled control that does not say what would enable it leaves the
            reader guessing, which is what the three greyed buttons did. */}
        {!canCommit && !isCommitting && !isPushing && (
          <p className="git-view__commit-hint">
            {whyCannotCommit(stagedFiles.length, commitMessage)}
          </p>
        )}
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
