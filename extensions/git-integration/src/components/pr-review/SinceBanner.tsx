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

const DIFF_RANGE_OPTIONS = [
  {
    value: 'since' as const,
    label: (
      <>
        Since my review <kbd className="tmui-kbd">s</kbd>
      </>
    ),
    accessibleName: 'Since my review',
  },
  { value: 'whole' as const, label: 'Whole PR' },
]

function SinceHeadline({
  commitCount,
  historyRewritten,
}: Pick<Props, 'commitCount' | 'historyRewritten'>) {
  if (historyRewritten) return <b>History rewritten since you last looked</b>
  return (
    <b>
      {commitCount} commit{commitCount === 1 ? '' : 's'} since you last looked
    </b>
  )
}

/**
 * S1: shown at the top of the review surface when a push happened since the
 * stored session was last opened.
 */
export function SinceBanner(props: Props) {
  const diffRange = useReviewUiStore((s) => s.diffRange)
  const setDiffRange = useReviewUiStore((s) => s.setDiffRange)
  return (
    <div className="rc-band" style={{ margin: 0, borderRadius: 0 }}>
      <SinceHeadline commitCount={props.commitCount} historyRewritten={props.historyRewritten} />
      {props.lastAccessedAt && (
        <span className="rc-note">
          <RelativeTime value={props.lastAccessedAt} />
        </span>
      )}
      <span className="rc-note">
        {props.changedCount} files changed · {props.stillViewedCount} still viewed
      </span>
      <span className="rc-sp" />
      <SegmentedControl
        label="Diff range"
        size="sm"
        options={DIFF_RANGE_OPTIONS}
        value={diffRange}
        onChange={setDiffRange}
      />
    </div>
  )
}
