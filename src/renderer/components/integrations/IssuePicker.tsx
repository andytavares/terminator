import React, { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useIntegrationsStore } from '../../stores/integrations.store'
import type { IssueListResult, IssueSummary, TrackerId } from '../../../shared/types/index'
import './IssuePicker.css'

// Choosing an issue, inline.
//
// The same job as the link dialog's list, but embedded in a form rather than
// owning a modal — the new-project dialog cannot open a second dialog over
// itself just to pick one row.

const TRACKER_LABELS: Record<TrackerId, string> = { linear: 'Linear', jira: 'Jira' }
const SEARCH_DEBOUNCE_MS = 250

const ERROR_TEXT: Record<string, string> = {
  'auth-failed': 'credential rejected',
  'rate-limited': 'rate limited',
  unavailable: 'unreachable',
  'not-found': 'not found',
  failed: 'failed',
}

export interface IssuePickerProps {
  selected: IssueSummary | null
  onSelect: (issue: IssueSummary) => void
  onClear: () => void
}

export function IssuePicker({ selected, onSelect, onClear }: IssuePickerProps): JSX.Element {
  const { listMine, searchIssues } = useIntegrationsStore()
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<IssueListResult>({ issues: [], failures: [] })
  const [loading, setLoading] = useState(false)
  // Guards against a slow earlier request replacing a faster later one.
  const requestId = useRef(0)

  useEffect(() => {
    if (!open) return
    const id = ++requestId.current
    const trimmed = term.trim()
    setLoading(true)

    const run = async (): Promise<void> => {
      const next =
        trimmed.length === 0 ? await listMine({ limit: 25 }) : await searchIssues(trimmed)
      if (id !== requestId.current) return
      setResult(next)
      setLoading(false)
    }

    if (trimmed.length === 0) {
      void run()
      return
    }
    const timer = setTimeout(() => void run(), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term, open, listMine, searchIssues])

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
    <div className="issue-picker">
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
