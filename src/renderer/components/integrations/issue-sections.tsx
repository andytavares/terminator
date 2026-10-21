import React from 'react'
import { Markdown, RelativeTime } from '@terminator/extension-ui'
import { TRACKER_LABELS } from './use-issue-search'
import type { Issue, TrackerId } from '../../../shared/types/index'
import './issue-sections.css'

// The sections of an issue that the drawer and Home's details view both render.
// Issue text is written by anyone who can comment on the ticket, so it renders
// with `fetchesNothing` and its links leave through the shell, never navigation.

function openExternalUrl(url: string): void {
  void window.electronAPI?.shell?.openExternal(url)
}

interface IssueTagsProps {
  issue: Issue
  /** Tracker tag shown first; left out when the caller names the tracker itself. */
  tracker?: TrackerId
  /** State chip shown first; the drawer shows the state in its key row instead. */
  showState?: boolean
}

/** State, assignee, branch and labels as chips, then when the issue last moved. */
export function IssueTags({ issue, tracker, showState = false }: IssueTagsProps): JSX.Element {
  return (
    <div className="issue-drawer__meta">
      {showState && <span className="issue-drawer__tag">{issue.state.name}</span>}
      {tracker !== undefined && (
        <span className="issue-drawer__tag">{TRACKER_LABELS[tracker]}</span>
      )}
      <span className="issue-drawer__tag">{issue.assignee?.name ?? 'Unassigned'}</span>
      {issue.branchName !== null && (
        <span className="issue-drawer__tag">branch {issue.branchName}</span>
      )}
      {issue.labels.map((label) => (
        <span key={label} className="issue-drawer__tag">
          {label}
        </span>
      ))}
      {issue.updatedAt !== '' && (
        <span className="issue-drawer__tag">
          updated <RelativeTime value={issue.updatedAt} />
        </span>
      )}
    </div>
  )
}

export function IssueDescriptionSection({ issue }: { issue: Issue }): JSX.Element {
  return (
    <section className="issue-drawer__section">
      {issue.description.trim().length > 0 ? (
        <Markdown fetchesNothing className="issue-markdown" onOpenLink={openExternalUrl}>
          {issue.description}
        </Markdown>
      ) : (
        <p className="issue-drawer__empty">No description.</p>
      )}
    </section>
  )
}

export function CommentsSection({ issue }: { issue: Issue }): JSX.Element {
  return (
    <section className="issue-drawer__section">
      <h3 className="issue-drawer__heading">
        Comments <span className="issue-drawer__count">{issue.comments.length}</span>
      </h3>
      {issue.comments.map((c, i) => (
        <div key={`${c.author}-${c.createdAt}-${i}`} className="issue-drawer__comment">
          <span className="issue-drawer__who">
            {c.author} · <RelativeTime value={c.createdAt} />
          </span>
          <Markdown fetchesNothing className="issue-markdown" onOpenLink={openExternalUrl}>
            {c.body}
          </Markdown>
        </div>
      ))}
    </section>
  )
}
