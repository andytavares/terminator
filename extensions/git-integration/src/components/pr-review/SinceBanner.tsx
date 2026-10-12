import React from 'react'
import { RelativeTime, SegmentedControl } from '@terminator/extension-ui'
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
      <SegmentedControl
        label="Diff range"
        size="sm"
        options={[
          {
            value: 'since',
            label: (
              <>
                Since my review <kbd className="tmui-kbd">s</kbd>
              </>
            ),
            accessibleName: 'Since my review',
          },
          { value: 'whole', label: 'Whole PR' },
        ]}
        value={diffRange}
        onChange={setDiffRange}
      />
    </div>
  )
}
