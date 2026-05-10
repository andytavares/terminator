import React, { useCallback, useEffect } from 'react'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { ReviewQueue } from './ReviewQueue'
import { PrReviewView } from './PrReviewView'
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
    nextPrCursor,
    includeClosedPrs,
    setIncludeClosedPrs,
  } = usePrReviewStore()
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
    await loadPrDetail(pr.number, async (detail) => {
      const key = `${repoRoot}:::${pr.number}:::${detail.headSHA}`
      const result = await window.electronAPI.github.sessionGet(key)
      const raw = (result as { session: unknown }).session
      if (raw) {
        const parsed = ReviewSessionSchema.safeParse(raw)
        if (parsed.success) initSession(parsed.data)
      }
      setActivePr(detail)
      // Kick off risk score computation in the background (non-blocking).
      // Pass detail directly so we don't depend on the store update flushing first.
      fetchFileMetrics(detail)
    })
  }

  const handleClosePr = () => {
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
    if (repoRoot) window.electronAPI.window.openPrReview(repoRoot)
  }

  if (!repoRoot) {
    return (
      <div className="pr-review-empty">
        <p>Open a project to view pull requests.</p>
      </div>
    )
  }

  if (activePr) {
    return (
      <PrReviewView
        repoRoot={repoRoot}
        pr={activePr}
        onClose={handleClosePr}
        onRefresh={handleRefreshPr}
        onPopOut={handlePopOut}
      />
    )
  }

  return (
    <div className="pr-review-tab-wrap">
      <div className="pr-review-tab-toolbar">
        <button className="pr-review-popout-btn" onClick={handlePopOut} title="Open in new window">
          ⬡ Pop out
        </button>
      </div>
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
