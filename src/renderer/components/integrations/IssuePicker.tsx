import React, { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { recordUse } from '../../usage/record'
import { ERROR_TEXT, TRACKER_LABELS, useIssueSearch } from './use-issue-search'
import type { IssueSummary } from '../../../shared/types/index'
import './issue-search.css'
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

export function IssuePicker({ selected, onSelect, onClear }: IssuePickerProps): React.JSX.Element {
  const { term, open, setOpen, rootRef, clear, search, pick } = useIssuePicker(onSelect, onClear)
  const { result, loading } = useIssueSearch(term, open, { limit: 25 })

  if (selected !== null) return <ChosenIssue issue={selected} onClear={clear} />

  return (
    <div
      className="issue-picker"
      ref={rootRef}
      onKeyDown={(e) => {
        // Only while the list is showing: with it closed, Escape belongs to
        // whatever the picker sits in, which is usually a dialog to close.
        if (e.key !== 'Escape' || !open) return
        e.stopPropagation()
        setOpen(false)
      }}
    >
      <IssueSearchBox term={term} onFocus={() => setOpen(true)} onChange={search} />
      {open && <PickerList result={result} loading={loading} onPick={pick} />}
    </div>
  )
}

/** The search text and the list, and what clearing, typing and picking do to them. */
function useIssuePicker(onSelect: (issue: IssueSummary) => void, onClear: () => void) {
  const [term, setTerm] = useState('')
  const { open, setOpen, rootRef } = useDropdown()
  return {
    term,
    open,
    setOpen,
    rootRef,
    clear: (): void => {
      onClear()
      setOpen(false)
      setTerm('')
    },
    search: (next: string): void => {
      if (term === '' && next !== '') recordUse('core.issues.search')
      setTerm(next)
      setOpen(true)
    },
    pick: (issue: IssueSummary): void => {
      onSelect(issue)
      setOpen(false)
    },
  }
}

/** Whether the list is open. The list is a dropdown, so it goes away the way one does: Escape,
 * or a pointer anywhere else. Without this it stayed open over whatever it was opened from, and
 * only picking an issue closed it. */
function useDropdown() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])
  return { open, setOpen, rootRef }
}

/** An issue's key, title and tracker, as the chosen chip and every row draw them. */
function IssueCells({ issue }: { issue: IssueSummary }): React.JSX.Element {
  return (
    <>
      <span className="issue-picker__key">{issue.key}</span>
      <span className="issue-picker__title">{issue.title}</span>
      <span className="issue-picker__tracker">{TRACKER_LABELS[issue.tracker]}</span>
    </>
  )
}

function ChosenIssue({ issue, onClear }: { issue: IssueSummary; onClear: () => void }) {
  return (
    <div className="issue-picker__chosen">
      <IssueCells issue={issue} />
      <button
        type="button"
        className="issue-picker__clear"
        title="Choose a different issue"
        onClick={onClear}
      >
        <X />
      </button>
    </div>
  )
}

interface SearchBoxProps {
  term: string
  onFocus: () => void
  onChange: (term: string) => void
}

function IssueSearchBox({ term, onFocus, onChange }: SearchBoxProps): React.JSX.Element {
  return (
    <div className="issue-picker__search">
      <Search />
      <input
        className="issue-picker__input"
        value={term}
        placeholder="Search, or type an issue key"
        onFocus={onFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

interface PickerListProps {
  result: ReturnType<typeof useIssueSearch>['result']
  loading: boolean
  onPick: (issue: IssueSummary) => void
}

/** What failed, then the issues (or why there are none). */
function PickerList({ result, loading, onPick }: PickerListProps): React.JSX.Element {
  // A tracker the operator never connected is not a failure worth warning
  // about — it is just absent. Only real failures are named.
  const reportable = result.failures.filter((f) => f.error !== 'not-connected')
  return (
    <div className="issue-picker__list">
      {reportable.length > 0 && (
        <p className="issue-picker__failures" role="status">
          {reportable.map((f) => `${TRACKER_LABELS[f.tracker]} ${ERROR_TEXT[f.error]}`).join(' · ')}
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
            onClick={() => onPick(candidate)}
          >
            <IssueCells issue={candidate} />
          </button>
        ))}
    </div>
  )
}
