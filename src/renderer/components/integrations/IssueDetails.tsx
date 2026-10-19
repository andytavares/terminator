import React, { useCallback, useEffect, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { Kbd } from '@terminator/extension-ui'
import { useStartWorkStore } from '../home/start-work'
import { ERROR_TEXT, TRACKER_LABELS } from './use-issue-search'
import { CommentsSection, IssueDescriptionSection, IssueTags } from './issue-sections'
import type { Issue, TrackerId } from '../../../shared/types/index'
import './IssueDetails.css'

// Any ticket's details, read by key rather than by a project's link, so Home can
// show one. The description and comments are the shared sections: the same
// rendering of untrusted issue text the drawer uses.

export interface IssueDetailsProps {
  tracker: TrackerId
  issueKey: string
  onClose: () => void
}

/** The outcome of one read: still running, the issue, or why it failed. */
type IssueOutcome =
  | { loading: true }
  | { loading: false; issue: Issue | null; error: string | null }

interface IssueRead {
  outcome: IssueOutcome
  issueKey: string
  refresh: () => void
}

/** The settled outcome of one getIssue call. */
function outcomeOf(
  result: { issue: Issue | null } | { error: string; message?: string }
): IssueOutcome {
  if ('error' in result) {
    return {
      loading: false,
      issue: null,
      error: result.message ?? ERROR_TEXT[result.error] ?? result.error,
    }
  }
  return { loading: false, issue: result.issue, error: null }
}

/** The issue behind `tracker`/`issueKey`, read again on demand; a refresh skips the cache. */
function useIssueByKey(tracker: TrackerId, issueKey: string): IssueRead {
  const [outcome, setOutcome] = useState<IssueOutcome>({ loading: true })
  const [attempt, setAttempt] = useState(0)
  const refreshing = attempt > 0

  useEffect(() => {
    let cancelled = false
    const input = refreshing
      ? { tracker, key: issueKey, refresh: true }
      : { tracker, key: issueKey }
    const applyOutcome = (next: IssueOutcome): void => {
      if (!cancelled) setOutcome(next)
    }
    void window.electronAPI.integrations
      .getIssue(input)
      .then((result) => applyOutcome(outcomeOf(result)))
      .catch(() => applyOutcome({ loading: false, issue: null, error: ERROR_TEXT.failed }))
    return () => {
      cancelled = true
    }
  }, [tracker, issueKey, refreshing])

  const refresh = useCallback(() => setAttempt((n) => n + 1), [])
  return { outcome, issueKey, refresh }
}

export function IssueDetails({ tracker, issueKey, onClose }: IssueDetailsProps): JSX.Element {
  const read = useIssueByKey(tracker, issueKey)
  const issue = read.outcome.loading ? null : read.outcome.issue
  return (
    <section className="issue-details" aria-label={`Issue ${issueKey}`}>
      <DetailsHeader tracker={tracker} read={read} onClose={onClose} />
      <DetailsBody issue={issue} />
    </section>
  )
}

/** The description and comments, once the issue has arrived. */
function DetailsBody({ issue }: { issue: Issue | null }): JSX.Element {
  if (issue === null) return <></>
  return (
    <>
      <IssueDescriptionSection issue={issue} />
      {issue.comments.length > 0 && <CommentsSection issue={issue} />}
    </>
  )
}

interface DetailsHeaderProps {
  tracker: TrackerId
  read: IssueRead
  onClose: () => void
}

/** `<KEY> · <tracker>` with an Esc hint, then the title and its buttons, or why there are none. */
function DetailsHeader({ tracker, read, onClose }: DetailsHeaderProps): JSX.Element {
  const label = TRACKER_LABELS[tracker]
  const issue = read.outcome.loading ? null : read.outcome.issue
  return (
    <header className="issue-drawer__top">
      <KeyRow label={label} read={read} />
      <DetailsStatus label={label} read={read} />
      {issue !== null && (
        <>
          <h4 className="issue-drawer__title">{issue.title}</h4>
          <DetailsActions
            issue={issue}
            label={label}
            act={{ refresh: read.refresh, close: onClose }}
          />
          <IssueTags issue={issue} showState />
        </>
      )}
    </header>
  )
}

function KeyRow({ label, read }: { label: string; read: IssueRead }): JSX.Element {
  return (
    <div className="issue-drawer__key-row">
      <span className="issue-drawer__key">
        {read.issueKey} · {label}
      </span>
      <span className="issue-details__esc">
        <Kbd>Esc</Kbd>
      </span>
    </div>
  )
}

/** The loading line, or the failure in plain words. */
function DetailsStatus({ label, read }: { label: string; read: IssueRead }) {
  const { outcome, issueKey } = read
  if (outcome.loading) return <p className="issue-drawer__empty">Loading {issueKey}…</p>
  if (outcome.error === null) return null
  return (
    <p className="issue-drawer__error" role="alert">
      {label} {outcome.error}
    </p>
  )
}

interface DetailsActionsProps {
  issue: Issue
  label: string
  /** Refresh the read, then close once the launcher takes over. */
  act: { refresh: () => void; close: () => void }
}

/** Open in the tracker, Refresh, and Start work. */
function DetailsActions({ issue, label, act }: DetailsActionsProps) {
  const startLauncher = (): void => {
    useStartWorkStore.getState().openLauncher(issue.key)
    act.close()
  }
  return (
    <div className="issue-details__actions">
      <button
        className="ext-btn"
        onClick={() => void window.electronAPI.shell.openExternal(issue.url)}
      >
        <ExternalLink /> Open in {label}
      </button>
      <button className="ext-btn" onClick={act.refresh}>
        <RefreshCw /> Refresh
      </button>
      <button className="ext-btn" onClick={startLauncher}>
        Start work
      </button>
    </div>
  )
}
