import React from 'react'
import { RelativeTime } from '@terminator/extension-ui'
import { useReviewUiStore } from '../../stores/review-ui.store'

interface Props {
  commitCount: number
  changedCount: number
  stillViewedCount: number
  lastAccessedAt: string | null
  historyRewritten: boolean
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
      {lastAccessedAt && (
        <span className="rc-note">
          <RelativeTime value={lastAccessedAt} />
        </span>
      )}
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
