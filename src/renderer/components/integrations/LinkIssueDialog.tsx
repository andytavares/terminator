import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { useModalEffect } from '../../stores/modal.store'
import type { IssueListResult, IssueSummary, TrackerId } from '../../../shared/types/index'
import '../sidebar/Dialog.css'
import './LinkIssueDialog.css'

// Picking the issue a project is for.
//
// Opens on the operator's own assigned issues, because that is what they are
// almost always reaching for — a picker that demands a search first makes the
// common case the slow one.

const TRACKER_LABELS: Record<TrackerId, string> = { linear: 'Linear', jira: 'Jira' }
const SEARCH_DEBOUNCE_MS = 250

const ERROR_TEXT: Record<string, string> = {
  'not-connected': 'not connected',
  'auth-failed': 'credential rejected',
  'rate-limited': 'rate limited',
  unavailable: 'unreachable',
  'not-found': 'not found',
  failed: 'failed',
}

export interface LinkIssueDialogProps {
  projectId: string
  projectName: string
  /** The key currently attached, if any — drives the replacement warning. */
  currentKey?: string | null
  onClose: () => void
  onLinked?: (issue: IssueSummary) => void
}

export function LinkIssueDialog({
  projectId,
  projectName,
  currentKey,
  onClose,
  onLinked,
}: LinkIssueDialogProps): JSX.Element {
  useModalEffect()
  const { listMine, searchIssues, linkIssue, isAnyConnected, loadConnections } =
    useIntegrationsStore()

  const [term, setTerm] = useState('')
  const [result, setResult] = useState<IssueListResult>({ issues: [], failures: [] })
  const [selected, setSelected] = useState<IssueSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Guards against a slow earlier request landing after a faster later one and
  // replacing the results the operator is currently looking at.
  const requestId = useRef(0)

  const connected = isAnyConnected()

  useEffect(() => {
    void loadConnections()
  }, [loadConnections])

  useEffect(() => {
    if (!connected) {
      setLoading(false)
      return
    }
    const id = ++requestId.current
    const trimmed = term.trim()
    setLoading(true)

    const run = async (): Promise<void> => {
      const next = trimmed.length === 0 ? await listMine() : await searchIssues(trimmed)
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
  }, [term, connected, listMine, searchIssues])

  const heading = useMemo(() => (term.trim().length === 0 ? 'Assigned to you' : 'Results'), [term])

  async function commit(): Promise<void> {
    if (selected === null) return
    setBusy(true)
    const ok = await linkIssue(projectId, selected.tracker, selected.key)
    setBusy(false)
    if (!ok) {
      setError('Could not attach that issue. Nothing was changed.')
      return
    }
    onLinked?.(selected)
    onClose()
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog link-issue" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog__title">Link an issue</h3>
        <p className="dialog__description">
          Attaching to <strong>{projectName}</strong>
        </p>

        {!connected ? (
          <div className="link-issue__empty">
            <p>No issue tracker is connected.</p>
            <p className="link-issue__hint">
              Connect Linear or Jira in Settings → Integrations, then come back.
            </p>
          </div>
        ) : (
          <>
            <div className="link-issue__search">
              <Search />
              <input
                className="link-issue__input"
                autoFocus
                value={term}
                placeholder="Search, or type an issue key"
                onChange={(e) => setTerm(e.target.value)}
              />
            </div>

            {result.failures.length > 0 && (
              <p className="link-issue__failures" role="status">
                {result.failures
                  .map((f) => `${TRACKER_LABELS[f.tracker]} ${ERROR_TEXT[f.error] ?? f.error}`)
                  .join(' · ')}
              </p>
            )}

            <div className="link-issue__list">
              <div className="link-issue__group">{heading}</div>
              {loading && <div className="link-issue__row link-issue__row--muted">Loading…</div>}
              {!loading && result.issues.length === 0 && (
                <div className="link-issue__row link-issue__row--muted">No issues found.</div>
              )}
              {!loading &&
                result.issues.map((issue) => (
                  <button
                    key={`${issue.tracker}:${issue.key}`}
                    type="button"
                    className={`link-issue__row${
                      selected?.key === issue.key && selected.tracker === issue.tracker
                        ? ' link-issue__row--selected'
                        : ''
                    }`}
                    onClick={() => setSelected(issue)}
                    onDoubleClick={() => void commit()}
                  >
                    <span className="link-issue__key">{issue.key}</span>
                    <span className="link-issue__title">{issue.title}</span>
                    <span className="link-issue__tracker">{TRACKER_LABELS[issue.tracker]}</span>
                    <span className="link-issue__state">{issue.state.name}</span>
                  </button>
                ))}
            </div>

            {currentKey != null && selected !== null && selected.key !== currentKey && (
              <p className="link-issue__warning" role="alert">
                {projectName} is attached to {currentKey}. Linking {selected.key} replaces it — a
                branch holds one issue.
              </p>
            )}

            {error !== null && (
              <p className="link-issue__warning" role="alert">
                {error}
              </p>
            )}
          </>
        )}

        <div className="dialog__actions">
          <button className="dialog__btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="dialog__btn-primary"
            disabled={selected === null || busy}
            onClick={() => void commit()}
          >
            {busy ? 'Linking…' : selected === null ? 'Link issue' : `Link ${selected.key}`}
          </button>
        </div>
      </div>
    </div>
  )
}
