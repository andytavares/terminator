import React from 'react'
import './FilterNotice.css'

interface FilterNoticeProps {
  shown: number
  total: number
  onShowAll: () => void
}

/**
 * States how much of the list is hidden, whenever any filter is active.
 *
 * Non-dismissible on purpose: a user who opens their laptop to 6 of 22
 * sessions with no explanation reads it as data loss. This is the cheapest
 * guard against the worst failure mode of the whole feature (FR-016).
 */
export function FilterNotice({ shown, total, onShowAll }: FilterNoticeProps): JSX.Element | null {
  if (shown >= total) return null
  return (
    <div className="filter-notice">
      <span>
        Filtered · showing {shown} of {total}
      </span>
      <button className="filter-notice__show-all" onClick={onShowAll}>
        show all
      </button>
    </div>
  )
}
