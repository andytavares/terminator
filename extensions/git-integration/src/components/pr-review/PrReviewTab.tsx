import React, { useCallback, useEffect, useState } from 'react'
import { githubAPI } from '../../api/github'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { ReviewQueue } from './ReviewQueue'
import { PrReviewView } from './PrReviewView'
import { PrOverviewPanel } from './PrOverviewPanel'
import { useLoadPrQueue, useLoadPrDetail, useFetchFileMetrics } from '../../hooks/usePrReview'
import { ReviewSessionSchema } from '../../schemas/pr-review.schema'
import type { ReviewQueuePR } from '../../schemas/pr-review.schema'
import './pr-review.css'

interface Props {
  repoRoot: string | null
}

export function PrReviewTab({ repoRoot }: Props) {
  const {
    activePr,
    setActivePr,
    initSession,
    reset,
    markPrInProgress,
    dismissPr,
    nextPrCursor,
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

  const handleLoadMore = async () => {
    if (!nextPrCursor) return
    await loadQueue({ cursor: nextPrCursor, append: true })
  }

  const handleOpenPr = async (pr: ReviewQueuePR) => {
    if (!repoRoot) return
    setActiveQueuePr(pr)
    await loadPrDetail(pr.number, async (detail) => {
      const key = `${repoRoot}:::${pr.number}:::${detail.headSHA}`
      const result = await githubAPI.sessionGet(key)
      const raw = (result as { session: unknown }).session
      if (raw) {
        const parsed = ReviewSessionSchema.safeParse(raw)
        if (parsed.success) initSession(parsed.data)
      } else {
        // Persist an initial session so the PR shows as in-progress on next queue load.
        await githubAPI.sessionSet(key, {
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
      // Persist the PR snapshot so it always appears in the in-progress section,
      // even if it falls beyond the first page on next load.
      void githubAPI.saveActiveReview(repoRoot, pr)
      // Immediately reflect in-progress in the queue without waiting for a refresh.
      markPrInProgress(pr.number)
      setActivePr(detail)
      setShowOverview(true)
      // Kick off risk score computation in the background (non-blocking).
      fetchFileMetrics(detail)
    })
  }

  const handleClosePr = async () => {
    // Persist paused state synchronously before resetting, so mergeSessionStatuses
    // on the next queue load reliably finds this session and shows it as paused.
    if (repoRoot && activePr) {
      const key = `${repoRoot}:::${activePr.number}:::${activePr.headSHA}`
      await githubAPI.sessionSet(key, {
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
    reset()
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
      const key = `${repoRoot}:::${prNumber}:::${detail.headSHA}`
      const result = await githubAPI.sessionGet(key)
      const raw = (result as { session: unknown }).session
      if (raw) {
        const parsed = ReviewSessionSchema.safeParse(raw)
        if (parsed.success) initSession(parsed.data)
      }
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

  if (activePr && showOverview) {
    return (
      <PrOverviewPanel
        pr={activePr}
        sessionStatus={activeQueuePr?.sessionStatus ?? 'not-started'}
        onStartReview={() => setShowOverview(false)}
        onClose={handleClosePr}
        onPopOut={isPoppedOut ? undefined : handlePopOut}
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
        onLoadMore={handleLoadMore}
        onDismissPr={handleDismissPr}
        includeClosedPrs={includeClosedPrs}
        onToggleClosedPrs={handleToggleClosed}
      />
    </div>
  )
}
