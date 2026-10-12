import React, { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { ERROR_TEXT, TRACKER_LABELS, useIssueSearch } from './use-issue-search'
import type { IssueSummary } from '../../../shared/types/index'
import './IssuePicker.css'

// Choosing an issue, inline.
//
// The same job as the link dialog's list, but embedded in a form rather than
// owning a modal — the new-project dialog cannot open a second dialog over
// itself just to pick one row.

export interface IssuePickerProps {
  selected: IssueSummary | null
  onSelect: (issue: IssueSummary) => void
  onClear: () => void
}

export function IssuePicker({ selected, onSelect, onClear }: IssuePickerProps): JSX.Element {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const { result, loading } = useIssueSearch(term, open, { limit: 25 })

  // The list is a dropdown, so it goes away the way one does: Escape, or a
  // pointer anywhere else. Without this it stayed open over whatever it was
  // opened from, and only picking an issue closed it.
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  // A tracker the operator never connected is not a failure worth warning
  // about — it is just absent. Only real failures are named.
  const reportable = result.failures.filter((f) => f.error !== 'not-connected')

  if (selected !== null) {
    return (
      <div className="issue-picker__chosen">
        <span className="issue-picker__key">{selected.key}</span>
        <span className="issue-picker__title">{selected.title}</span>
        <span className="issue-picker__tracker">{TRACKER_LABELS[selected.tracker]}</span>
        <button
          type="button"
          className="issue-picker__clear"
          title="Choose a different issue"
          onClick={() => {
            onClear()
            setOpen(false)
            setTerm('')
          }}
        >
          <X />
        </button>
      </div>
    )
  }

  return (
    <div
      className="issue-picker"
      ref={rootRef}
      onKeyDown={(e) => {
        // Only while the list is showing: with it closed, Escape belongs to
        // whatever the picker sits in, which is usually a dialog to close.
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <div className="issue-picker__search">
        <Search />
        <input
          className="issue-picker__input"
          value={term}
          placeholder="Search, or type an issue key"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setTerm(e.target.value)
            setOpen(true)
          }}
        />
      </div>

      {open && (
        <div className="issue-picker__list">
          {reportable.length > 0 && (
            <p className="issue-picker__failures" role="status">
              {reportable
                .map((f) => `${TRACKER_LABELS[f.tracker]} ${ERROR_TEXT[f.error]}`)
                .join(' · ')}
            </p>
          )}
          {loading && <div className="issue-picker__row issue-picker__row--muted">Loading…</div>}
          {!loading && result.issues.length === 0 && (
            <div className="issue-picker__row issue-picker__row--muted">No issues found.</div>
          )}
          {!loading &&
            result.issues.map((candidate) => (
              <button
                key={`${candidate.tracker}:${candidate.key}`}
                type="button"
                className="issue-picker__row"
                onClick={() => {
                  onSelect(candidate)
                  setOpen(false)
                }}
              >
                <span className="issue-picker__key">{candidate.key}</span>
                <span className="issue-picker__title">{candidate.title}</span>
                <span className="issue-picker__tracker">{TRACKER_LABELS[candidate.tracker]}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
