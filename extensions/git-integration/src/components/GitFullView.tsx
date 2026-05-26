import React, { useState, useCallback, useRef } from 'react'
import './git-integration.css'
import { useGitStore } from '../stores/git.store'
import { useGitStatus } from '../hooks/useGitStatus'
import { useResizePanel } from '../hooks/useResizePanel'
import { StagingArea } from './StagingArea'
import { FileDiffView } from './FileDiffView'
import { PrDialog } from './PrDialog'
import type { FileDiff, PullRequest } from '../schemas/git.schema'
import { gitAPI } from '../api/git'
import { MergeFlowView } from './merge-flow/MergeFlowView'

interface Props {
  repoRoot: string | null
}

export function GitFullView({ repoRoot }: Props): JSX.Element {
  useGitStatus(repoRoot)

  const { size: changesWidth, handleMouseDown: handleDividerMouseDown } = useResizePanel(
    300,
    160,
    600,
    -1
  )

  const {
    status,
    selectedFile,
    diffCache,
    setSelectedFile,
    setDiff,
    setLoading,
    clearDiffCache,
    view,
    setView,
  } = useGitStore()
  const [commitMessage, setCommitMessage] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [showPrDialog, setShowPrDialog] = useState(false)
  const [existingPr, setExistingPr] = useState<PullRequest | null>(null)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [hookOutput, setHookOutput] = useState<string | null>(null)
  const [isHookFailure, setIsHookFailure] = useState(false)
  const [commitPhase, setCommitPhase] = useState<'idle' | 'hooks' | 'committing'>('idle')
  const [hookLines, setHookLines] = useState<string[]>([])
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const selectedDiff: FileDiff | null = selectedFile ? (diffCache.get(selectedFile) ?? null) : null

  const handleFileSelect = useCallback(
    async (path: string, staged: boolean) => {
      if (!repoRoot) return
      setSelectedFile(path)
      if (!diffCache.has(path)) {
        setLoading(true)
        try {
          const fileStatus = status?.files.find((f) => f.path === path)
          const isUntracked = fileStatus?.status === 'untracked'
          const result = (await gitAPI.diffFile(repoRoot, path, staged, isUntracked)) as
            | { diff: FileDiff }
            | { error: string }
          if ('diff' in result) setDiff(path, result.diff)
        } finally {
          setLoading(false)
        }
      }
    },
    [repoRoot, status, diffCache, setSelectedFile, setDiff, setLoading]
  )

  const stagedFiles = status?.files.filter((f) => f.staged) ?? []
  const canCommit = stagedFiles.length > 0 && commitMessage.trim().length > 0
  const charCount = commitMessage.length
  const showCharCount = charCount > 50

  const startCommitPhase = useCallback((root: string) => {
    setCommitPhase('hooks')
    setHookLines([])
    // After 3s with no output switch label; actual output still streams in
    phaseTimerRef.current = setTimeout(() => setCommitPhase('committing'), 3000)
    pollIntervalRef.current = setInterval(async () => {
      const result = await gitAPI.commitOutputPoll(root)
      const { lines } = result as { lines: string[] }
      if (lines.length > 0) {
        setCommitPhase('hooks')
        if (phaseTimerRef.current) {
          clearTimeout(phaseTimerRef.current)
          phaseTimerRef.current = setTimeout(() => setCommitPhase('committing'), 3000)
        }
        setHookLines((prev) => [...prev, ...lines])
      }
    }, 300)
  }, [])

  const endCommitPhase = useCallback(() => {
    if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current)
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    setCommitPhase('idle')
  }, [])

  const applyCommitResult = useCallback(
    (
      result:
        | { commitHash: string }
        | { error: string; hookOutput?: string; isHookFailure?: boolean }
    ) => {
      if ('error' in result) {
        const msgs: Record<string, string> = {
          NOTHING_TO_COMMIT: 'Nothing staged to commit. Stage at least one file first.',
          EMPTY_MESSAGE: 'Commit message cannot be empty.',
          TIMEOUT: 'Commit timed out — a pre-commit hook may have hung.',
          HOOK_FAILED: 'Pre-commit hooks failed.',
        }
        setCommitError(msgs[result.error] ?? result.error)
        setHookOutput(result.hookOutput ?? null)
        setIsHookFailure(result.isHookFailure ?? false)
        return false
      }
      setCommitMessage('')
      setHookOutput(null)
      setIsHookFailure(false)
      setCommitError(null)
      setHookLines([])
      return true
    },
    [setCommitMessage]
  )

  const handleCommit = useCallback(
    async (noVerify = false) => {
      if (!canCommit || !repoRoot) return
      setIsCommitting(true)
      setCommitError(null)
      setHookOutput(null)
      setIsHookFailure(false)
      startCommitPhase(repoRoot)
      try {
        const result = await gitAPI.commit(repoRoot, commitMessage.trim(), false, noVerify)
        applyCommitResult(result)
      } finally {
        setIsCommitting(false)
        endCommitPhase()
      }
    },
    [repoRoot, commitMessage, canCommit, startCommitPhase, endCommitPhase, applyCommitResult]
  )

  const handleOpenPr = useCallback(async () => {
    if (!repoRoot) return
    const prResult = (await gitAPI.prStatus(repoRoot)) as
      | { pr: PullRequest | null }
      | { error: string }
    const pr = 'pr' in prResult ? prResult.pr : null
    setExistingPr(pr)
    setShowPrDialog(true)
  }, [repoRoot])

  const handleCommitAndPush = useCallback(
    async (noVerify = false) => {
      if (!canCommit || !repoRoot) return
      setIsCommitting(true)
      setCommitError(null)
      setHookOutput(null)
      setIsHookFailure(false)
      startCommitPhase(repoRoot)
      try {
        const result = await gitAPI.commit(repoRoot, commitMessage.trim(), false, noVerify)
        if (!applyCommitResult(result)) return
        setIsCommitting(false)
        endCommitPhase()
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
        endCommitPhase()
      }
    },
    [repoRoot, commitMessage, canCommit, startCommitPhase, endCommitPhase, applyCommitResult]
  )

  const handlePrCreated = useCallback((pr: PullRequest) => {
    setShowPrDialog(false)
    window.dispatchEvent(new CustomEvent('git:pr-created', { detail: { pr } }))
  }, [])

  if (!repoRoot) {
    return <div className="git-full-view git-full-view--empty">No project selected.</div>
  }

  if (view === 'merge-flow') {
    return <MergeFlowView repoRoot={repoRoot} onExit={() => setView('default')} />
  }

  return (
    <div className="git-full-view">
      {/* Left: diff / code view */}
      <div className="git-full-view__diff-pane">
        <FileDiffView diff={selectedDiff} />
      </div>

      <div className="git-resize-handle" onMouseDown={handleDividerMouseDown} />

      {/* Right: changes list + commit */}
      <div className="git-full-view__changes-pane" style={{ width: changesWidth }}>
        {status?.hasConflicts && (
          <div className="git-full-view__conflict-banner">
            <span className="git-full-view__conflict-banner-text">Merge conflicts detected</span>
            <button
              className="git-full-view__conflict-banner-btn"
              onClick={() => setView('merge-flow')}
            >
              Resolve conflicts →
            </button>
          </div>
        )}
        <div className="git-full-view__staging">
          <StagingArea
            repoRoot={repoRoot}
            onFileSelect={handleFileSelect}
            onStagingChange={clearDiffCache}
          />
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
          {commitError && (
            <div className="git-view__commit-error">
              <span className="git-view__commit-error-msg">{commitError}</span>
              {hookOutput && (
                <details className="git-view__hook-output">
                  <summary className="git-view__hook-output-summary">Hook output</summary>
                  <pre className="git-view__hook-output-pre">{hookOutput}</pre>
                </details>
              )}
              {isHookFailure && (
                <button
                  className="git-view__btn git-view__btn--danger git-view__btn--sm"
                  onClick={() => handleCommit(true)}
                  disabled={isCommitting || isPushing}
                >
                  Commit without hooks
                </button>
              )}
            </div>
          )}
          <div className="git-view__commit-actions">
            <div className="git-view__commit-hint">
              {isCommitting && hookLines.length > 0 && (
                <pre className="git-view__hook-live">{hookLines.join('\n')}</pre>
              )}
              {isCommitting && hookLines.length === 0 && commitPhase === 'hooks' && (
                <span className="git-view__hint-text git-view__hint-text--status">
                  ⟳ Running pre-commit hooks…
                </span>
              )}
              {isCommitting && hookLines.length === 0 && commitPhase === 'committing' && (
                <span className="git-view__hint-text git-view__hint-text--status">
                  ⟳ Committing…
                </span>
              )}
              {!isCommitting && stagedFiles.length === 0 && (
                <span className="git-view__hint-text">Stage at least one file to commit</span>
              )}
              {!isCommitting && stagedFiles.length > 0 && !commitMessage.trim() && (
                <span className="git-view__hint-text">Enter a commit message</span>
              )}
            </div>
            <div className="git-view__buttons">
              <button className="git-view__btn git-view__btn--secondary" onClick={handleOpenPr}>
                Open PR
              </button>
              <button
                className="git-view__btn git-view__btn--secondary"
                onClick={() => handleCommit(false)}
                disabled={!canCommit || isCommitting || isPushing}
              >
                Commit
              </button>
              <button
                className="git-view__btn git-view__btn--primary"
                onClick={() => handleCommitAndPush(false)}
                disabled={!canCommit || isCommitting || isPushing}
              >
                {isPushing ? '⟳ Pushing…' : 'Commit & Push'}
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
