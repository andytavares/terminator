import React from 'react'
import { useReviewUiStore } from '../../stores/review-ui.store'

interface Props {
  commitCount: number
  changedCount: number
  stillViewedCount: number
  lastAccessedAt: string | null
  historyRewritten: boolean
}

/** "2 h ago" / "3 d ago" / "just now", relative to now. */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffMs = Date.now() - then
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} d ago`
}

/**
 * S1: shown at the top of the review surface when a push happened since the
 * stored session was last opened.
 */
export function SinceBanner({
  commitCount,
  changedCount,
  stillViewedCount,
  lastAccessedAt,
  historyRewritten,
}: Props) {
  const diffRange = useReviewUiStore((s) => s.diffRange)
  const setDiffRange = useReviewUiStore((s) => s.setDiffRange)

  return (
    <div className="rc-band" style={{ margin: 0, borderRadius: 0 }}>
      {historyRewritten ? (
        <b>History rewritten since you last looked</b>
      ) : (
        <b>
          {commitCount} commit{commitCount === 1 ? '' : 's'} since you last looked
        </b>
      )}
      <span className="rc-note">{formatRelativeTime(lastAccessedAt)}</span>
      <span className="rc-note">
        {changedCount} files changed · {stillViewedCount} still viewed
      </span>
      <span className="rc-sp" />
      <div className="rc-seg" role="group" aria-label="Diff range">
        <button
          type="button"
          aria-pressed={diffRange === 'since'}
          onClick={() => setDiffRange('since')}
        >
          Since my review <span className="rc-kbd">s</span>
        </button>
        <button
          type="button"
          aria-pressed={diffRange === 'whole'}
          onClick={() => setDiffRange('whole')}
        >
          Whole PR
        </button>
      </div>
    </div>
  )
}
