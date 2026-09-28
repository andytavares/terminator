import React, { useCallback, useEffect, useRef, useState } from 'react'
import { githubAPI } from '../../api/github'
import { usePrReviewStore, sessionKey, legacySessionKey } from '../../stores/pr-review.store'
import { useReviewUiStore } from '../../stores/review-ui.store'
import { ReviewQueue } from './ReviewQueue'
import { PrReviewView } from './PrReviewView'
import type { SinceInfo } from './PrReviewView'
import { PrOverviewPanel } from './PrOverviewPanel'
import { MergeFlowView } from '../merge-flow/MergeFlowView'
import {
  useLoadPrQueue,
  useLoadPrDetail,
  useFetchFileMetrics,
  useLoadIssueComments,
} from '../../hooks/usePrReview'
import { ReviewSessionSchema } from '../../schemas/pr-review.schema'
import type { ReviewQueuePR, PrReviewDetail } from '../../schemas/pr-review.schema'
import './pr-review.css'

/**
 * Reads a stored session for a PR, preferring the v2 (per-PR) key and
 * falling back to the v1 (per-head) key so a push doesn't start a blank
 * session. If the session's head is stale, reconciles it against the
 * fetched detail and returns the S1 banner info to show for it.
 */
async function loadAndReconcileSession(
  repoRoot: string,
  detail: PrReviewDetail,
  initSession: ReturnType<typeof usePrReviewStore.getState>['initSession'],
  reconcileHead: ReturnType<typeof usePrReviewStore.getState>['reconcileHead']
): Promise<SinceInfo | null> {
  const key = sessionKey(repoRoot, detail.number)
  let result = await githubAPI.sessionGet(key)
  let raw = (result as { session: unknown }).session
  if (!raw) {
    const legacyResult = await githubAPI.sessionGet(
      legacySessionKey(repoRoot, detail.number, detail.headSHA)
    )
    raw = (legacyResult as { session: unknown }).session
    result = legacyResult
  }
  if (!raw) return null

  const parsed = ReviewSessionSchema.safeParse(raw)
  if (!parsed.success) return null
  initSession(parsed.data)

  if (parsed.data.headSHA === detail.headSHA) return null

  const compare = (await githubAPI.prCompare(repoRoot, parsed.data.headSHA, detail.headSHA)) as {
    rewritten: boolean
    commits: number
    files: Array<{ path: string; status?: string }>
  }
  reconcileHead(
    repoRoot,
    detail.number,
    detail.headSHA,
    compare.rewritten ? 'all' : compare.files.map((f) => f.path),
    compare.files.filter((f) => f.status === 'added').map((f) => f.path)
  )
  return {
    commitCount: compare.commits,
    changedCount: compare.files.length,
    historyRewritten: compare.rewritten,
  }
}

interface Props {
  repoRoot: string | null
}

/** Pages fetched automatically after the first, per queue load. */
const MAX_AUTO_PAGES = 10

export function PrReviewTab({ repoRoot }: Props) {
  const {
    activePr,
    setActivePr,
    initSession,
    reconcileHead,
    reset,
    markPrInProgress,
    dismissPr,
    nextPrCursor,
    hasMorePrs,
    queueLoading,
    loadingMorePrs,
    includeClosedPrs,
    setIncludeClosedPrs,
    viewedFiles,
    currentChapterId,
    currentFilePath,
    fileOrderOverrides,
    scrollPosition,
  } = usePrReviewStore()
  const isPopoutWindow = new URLSearchParams(window.location.search).get('view') === 'pr-review'
  const [isPoppedOut, setIsPoppedOut] = useState(isPopoutWindow)
  const [showOverview, setShowOverview] = useState(false)
  const [activeQueuePr, setActiveQueuePr] = useState<ReviewQueuePR | null>(null)
  const [mergeFlowWorktree, setMergeFlowWorktree] = useState<string | null>(null)
  const [sinceInfo, setSinceInfo] = useState<SinceInfo | null>(null)

  useEffect(() => {
    if (!isPopoutWindow) return
    document.title = activePr ? `#${activePr.number} ${activePr.title} — Review` : 'Code Reviews'
  }, [isPopoutWindow, activePr])

  useEffect(() => {
    if (isPopoutWindow) return
    // Listen for auxiliary window open/close events via extensionBridge
    const unsubOpen = window.electronAPI.extensionBridge.on('window:pr-review-opened', () =>
      setIsPoppedOut(true)
    )
    const unsubClose = window.electronAPI.extensionBridge.on('window:pr-review-closed', () =>
      setIsPoppedOut(false)
    )
    return () => {
      unsubOpen()
      unsubClose()
    }
  }, [isPopoutWindow])
  const loadQueue = useLoadPrQueue(repoRoot)
  const loadPrDetail = useLoadPrDetail(repoRoot)
  const fetchFileMetrics = useFetchFileMetrics(repoRoot)
  const loadIssueComments = useLoadIssueComments(repoRoot)

  useEffect(() => {
    if (repoRoot) loadQueue()
  }, [repoRoot, loadQueue])

  const handleRefreshQueue = useCallback(
    async (options?: { search?: string; includeClosedPrs?: boolean }) => {
      await loadQueue({ search: options?.search, includeClosedPrs: options?.includeClosedPrs })
    },
    [loadQueue]
  )

  const handleToggleClosed = async (include: boolean) => {
    setIncludeClosedPrs(include)
    await loadQueue({ includeClosedPrs: include })
  }

  // The queue is meant to be worked top to bottom, and "Load more pull
  // requests" made finishing it a manual chore — while the summary above it
  // could only count the rows already held, so it reported the page size as
  // the total. Pages follow on their own now, bounded so a repository with
  // thousands of open PRs cannot turn one screen into hundreds of API calls;
  // past the bound the summary still states the real total from `totalCount`,
  // and search reaches anything the list has not got to.
  const autoPagesRef = useRef(0)
  useEffect(() => {
    autoPagesRef.current = 0
  }, [repoRoot, includeClosedPrs])
  useEffect(() => {
    if (!hasMorePrs || !nextPrCursor) return
    if (queueLoading || loadingMorePrs) return
    if (autoPagesRef.current >= MAX_AUTO_PAGES) return
    autoPagesRef.current += 1
    void loadQueue({ cursor: nextPrCursor, append: true })
  }, [hasMorePrs, nextPrCursor, queueLoading, loadingMorePrs, loadQueue])

  const handleOpenPr = async (pr: ReviewQueuePR) => {
    if (!repoRoot) return
    setActiveQueuePr(pr)
    await loadPrDetail(pr.number, async (detail) => {
      const since = await loadAndReconcileSession(repoRoot, detail, initSession, reconcileHead)
      setSinceInfo(since)
      if (!since) {
        const hasSession = !!(await githubAPI.sessionGet(sessionKey(repoRoot, pr.number))).session
        if (!hasSession) {
          // Persist an initial session so the PR shows as in-progress on next queue load.
          await githubAPI.sessionSet(sessionKey(repoRoot, pr.number), {
            repoRoot,
            prNumber: pr.number,
            headSHA: detail.headSHA,
            currentChapterId: null,
            currentFilePath: null,
            viewedFiles: [],
            fileOrderOverrides: {},
            scrollPosition: null,
            pausedAt: null,
            lastAccessedAt: new Date().toISOString(),
          })
        }
      }
      // Persist the PR snapshot so it always appears in the in-progress section,
      // even if it falls beyond the first page on next load.
      void githubAPI.saveActiveReview(repoRoot, pr)
      // Immediately reflect in-progress in the queue without waiting for a refresh.
      markPrInProgress(pr.number)
      useReviewUiStore.getState().resetForPr()
      setActivePr(detail)
      setShowOverview(true)
      // Kick off risk score computation in the background (non-blocking).
      fetchFileMetrics(detail)
      // Load conversation comments in the background (pass prNumber directly to avoid stale closure).
      void loadIssueComments(detail.number)
    })
  }

  const handleClosePr = async () => {
    // Persist paused state synchronously before resetting, so mergeSessionStatuses
    // on the next queue load reliably finds this session and shows it as paused.
    if (repoRoot && activePr) {
      await githubAPI.sessionSet(sessionKey(repoRoot, activePr.number), {
        repoRoot,
        prNumber: activePr.number,
        headSHA: activePr.headSHA,
        currentChapterId,
        currentFilePath,
        viewedFiles: [...viewedFiles],
        fileOrderOverrides,
        scrollPosition,
        pausedAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      })
    }
    setShowOverview(false)
    setActiveQueuePr(null)
    setActivePr(null)
    setSinceInfo(null)
    reset()
    useReviewUiStore.getState().resetForPr()
    if (repoRoot) void loadQueue({ search: undefined })
  }

  const handleDismissPr = useCallback(
    async (prNumber: number) => {
      if (!repoRoot) return
      dismissPr(prNumber)
      await githubAPI.removeActiveReview(repoRoot, prNumber)
    },
    [repoRoot, dismissPr]
  )

  const handleRefreshPr = async () => {
    if (!activePr) return
    await loadPrDetail(activePr.number, async (detail) => {
      setActivePr(detail)
      fetchFileMetrics(detail)
    })
  }

  const handlePopOut = () => {
    if (!repoRoot) return
    const params: Record<string, string> = { repoRoot }
    if (activePr) {
      params.prNumber = String(activePr.number)
      params.showOverview = showOverview ? 'true' : 'false'
    }
    void window.electronAPI.extensionBridge.invoke('window:open-pr-review', params)
  }

  // Auto-open the active PR when the popout window is initialized with a prNumber URL param
  useEffect(() => {
    if (!isPopoutWindow || !repoRoot) return
    const urlParams = new URLSearchParams(window.location.search)
    const prNumberParam = urlParams.get('prNumber')
    if (!prNumberParam) return
    const prNumber = parseInt(prNumberParam, 10)
    if (isNaN(prNumber)) return
    const shouldShowOverview = urlParams.get('showOverview') === 'true'
    loadPrDetail(prNumber, async (detail) => {
      const since = await loadAndReconcileSession(repoRoot, detail, initSession, reconcileHead)
      setSinceInfo(since)
      useReviewUiStore.getState().resetForPr()
      setActivePr(detail)
      setShowOverview(shouldShowOverview)
      fetchFileMetrics(detail)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!repoRoot) {
    return (
      <div className="pr-review-empty">
        <p>Open a project to view pull requests.</p>
      </div>
    )
  }

  if (mergeFlowWorktree) {
    return <MergeFlowView repoRoot={mergeFlowWorktree} onExit={() => setMergeFlowWorktree(null)} />
  }

  if (activePr && showOverview) {
    return (
      <PrOverviewPanel
        repoRoot={repoRoot}
        pr={activePr}
        sessionStatus={activeQueuePr?.sessionStatus ?? 'not-started'}
        onStartReview={() => setShowOverview(false)}
        onClose={handleClosePr}
        onRefresh={handleRefreshPr}
        onPopOut={isPoppedOut ? undefined : handlePopOut}
        onStartMergeFlow={(worktreePath) => setMergeFlowWorktree(worktreePath)}
      />
    )
  }

  if (activePr && !showOverview) {
    return (
      <PrReviewView
        repoRoot={repoRoot}
        pr={activePr}
        onClose={handleClosePr}
        onRefresh={handleRefreshPr}
        onShowOverview={() => setShowOverview(true)}
        onPopOut={isPoppedOut ? undefined : handlePopOut}
        sinceInfo={sinceInfo}
      />
    )
  }

  return (
    <div className="pr-review-tab-wrap">
      {!isPoppedOut && (
        <div className="pr-review-tab-toolbar">
          <button
            className="pr-review-popout-btn"
            onClick={handlePopOut}
            title="Open in new window"
          >
            ⬡ Pop out
          </button>
        </div>
      )}
      <ReviewQueue
        repoRoot={repoRoot}
        onOpenPr={handleOpenPr}
        onRefresh={handleRefreshQueue}
        onDismissPr={handleDismissPr}
        includeClosedPrs={includeClosedPrs}
        onToggleClosedPrs={handleToggleClosed}
      />
    </div>
  )
}
