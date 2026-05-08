import React, { useEffect } from 'react'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { ReviewQueue } from './ReviewQueue'
import { PrReviewView } from './PrReviewView'
import { useLoadPrQueue, useLoadPrDetail } from '../../hooks/usePrReview'
import { ReviewSessionSchema } from '../../../../../src/shared/schemas/pr-review.schema'
import type { ReviewQueuePR } from '../../../../../src/shared/schemas/pr-review.schema'
import './pr-review.css'

interface Props {
  repoRoot: string | null
}

export function PrReviewTab({ repoRoot }: Props) {
  const { activePr, setActivePr, initSession, reset } = usePrReviewStore()
  const loadQueue = useLoadPrQueue(repoRoot)
  const loadPrDetail = useLoadPrDetail(repoRoot)

  useEffect(() => {
    if (repoRoot) loadQueue()
  }, [repoRoot])

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
    })
  }

  const handleClosePr = () => {
    setActivePr(null)
    reset()
    if (repoRoot) loadQueue()
  }

  if (!repoRoot) {
    return (
      <div className="pr-review-empty">
        <p>Open a project to view pull requests.</p>
      </div>
    )
  }

  if (activePr) {
    return <PrReviewView repoRoot={repoRoot} pr={activePr} onClose={handleClosePr} />
  }

  return <ReviewQueue repoRoot={repoRoot} onOpenPr={handleOpenPr} />
}
