import React, { useCallback, useEffect, useState } from 'react'
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
    nextPrCursor,
    includeClosedPrs,
    setIncludeClosedPrs,
  } = usePrReviewStore()
  const isPopoutWindow = new URLSearchParams(window.location.search).get('view') === 'pr-review'
  const [isPoppedOut, setIsPoppedOut] = useState(isPopoutWindow)
  const [showOverview, setShowOverview] = useState(false)
  const [activeQueuePr, setActiveQueuePr] = useState<ReviewQueuePR | null>(null)

  useEffect(() => {
    if (isPopoutWindow) return
    return window.electronAPI.window.onPrReviewWindowChange(setIsPoppedOut)
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
      const result = await window.electronAPI.github.sessionGet(key)
      const raw = (result as { session: unknown }).session
      if (raw) {
        const parsed = ReviewSessionSchema.safeParse(raw)
        if (parsed.success) initSession(parsed.data)
      } else {
        // Persist an initial session so the PR shows as in-progress on next queue load.
        await window.electronAPI.github.sessionSet(key, {
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
      // Immediately reflect in-progress in the queue without waiting for a refresh.
      markPrInProgress(pr.number)
      setActivePr(detail)
      setShowOverview(true)
      // Kick off risk score computation in the background (non-blocking).
      fetchFileMetrics(detail)
    })
  }

  const handleClosePr = () => {
    setShowOverview(false)
    setActiveQueuePr(null)
    setActivePr(null)
    reset()
    if (repoRoot) loadQueue({ search: undefined })
  }

  const handleRefreshPr = async () => {
    if (!activePr) return
    await loadPrDetail(activePr.number, async (detail) => {
      setActivePr(detail)
      fetchFileMetrics(detail)
    })
  }

  const handlePopOut = () => {
    if (repoRoot) void window.electronAPI.window.openPrReview(repoRoot)
  }

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
        includeClosedPrs={includeClosedPrs}
        onToggleClosedPrs={handleToggleClosed}
      />
    </div>
  )
}
