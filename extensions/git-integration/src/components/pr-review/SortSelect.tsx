import React from 'react'
import type { SortMode } from '../../review/sort-prs'

const OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'closest', label: 'Closest to merging' },
  { value: 'started', label: 'Started by you' },
]

export function SortSelect({
  value,
  onChange,
}: {
  value: SortMode
  onChange: (mode: SortMode) => void
}): JSX.Element {
  return (
    <select
      className="rd-sort"
      aria-label="Sort"
      value={value}
      onChange={(e) => onChange(e.target.value as SortMode)}
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
