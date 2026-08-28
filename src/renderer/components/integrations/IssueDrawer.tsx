import React, { useEffect, useState } from 'react'
import { ExternalLink, RefreshCw, X } from 'lucide-react'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { IssueMarkdown } from './IssueMarkdown'
import type { AgentContext, Issue, TrackerId } from '../../../shared/types/index'
import './IssueDrawer.css'

// The attached issue, read without leaving the app.
//
// The last block is the one that matters: the literal text an agent session
// will receive, with its size against the runtime's cap. What the operator
// inspects here is produced by the same function that writes the file a
// session reads — not a second rendering of the same idea (FR-023).

const TRACKER_LABELS: Record<TrackerId, string> = { linear: 'Linear', jira: 'Jira' }
const CONTEXT_LIMIT = 10_000
/** Where the counter starts warning: close enough that trimming is imminent. */
const CONTEXT_WARN_AT = 0.85

function relative(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const minutes = Math.round((Date.now() - then) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export interface IssueDrawerProps {
  projectId: string
  projectName: string
  onClose: () => void
}

export function IssueDrawer({ projectId, projectName, onClose }: IssueDrawerProps): JSX.Element {
  const { linkFor, issueFor, loadLink, unlinkIssue } = useIntegrationsStore()
  const link = linkFor(projectId)
  const issue: Issue | null = issueFor(projectId)

  const [context, setContext] = useState<AgentContext | null>(null)
  const [busy, setBusy] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.electronAPI.integrations
      .contextPreview({ projectId })
      .then((result) => {
        if (cancelled || 'error' in result) return
        setContext(result.context)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [projectId, issue])

  async function refresh(): Promise<void> {
    if (link === null) return
    setBusy(true)
    setError(null)
    await window.electronAPI.integrations.getIssue({
      tracker: link.tracker,
      key: link.key,
      refresh: true,
    })
    await loadLink(projectId)
    setBusy(false)
  }

  async function comment(): Promise<void> {
    if (link === null || commentText.trim().length === 0) return
    setBusy(true)
    setError(null)
    const result = await window.electronAPI.integrations.comment({
      tracker: link.tracker,
      key: link.key,
      body: commentText.trim(),
    })
    setBusy(false)
    if ('error' in result) {
      // Their words stay in the box. Losing what someone just typed because a
      // token expired is the worst possible response to a failed write.
      setError(result.message ?? 'Could not post that comment.')
      return
    }
    setCommentText('')
    await loadLink(projectId)
  }

  async function toggleInjection(next: boolean): Promise<void> {
    const result = await window.electronAPI.integrations.setInjectContext({
      projectId,
      injectContext: next,
    })
    if ('error' in result) {
      setError(result.message ?? 'Could not change that setting.')
      return
    }
    await loadLink(projectId)
  }

  if (link === null) return <></>

  const ratio = context === null ? 0 : context.chars / CONTEXT_LIMIT
  const counterClass = ratio >= CONTEXT_WARN_AT ? ' issue-drawer__counter--warn' : ''

  return (
    <aside className="issue-drawer" aria-label={`Issue ${link.key}`}>
      <header className="issue-drawer__top">
        <div className="issue-drawer__key-row">
          <span className="issue-drawer__key">{link.key}</span>
          {issue !== null && <span className="issue-drawer__state">{issue.state.name}</span>}
          <div className="issue-drawer__top-actions">
            <button
              className="issue-drawer__icon-btn"
              title="Refresh"
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw />
            </button>
            {issue !== null && (
              <button
                className="issue-drawer__icon-btn"
                title={`Open in ${TRACKER_LABELS[link.tracker]}`}
                onClick={() => void window.electronAPI.shell.openExternal(issue.url)}
              >
                <ExternalLink />
              </button>
            )}
            <button className="issue-drawer__icon-btn" title="Close" onClick={onClose}>
              <X />
            </button>
          </div>
        </div>

        {issue === null ? (
          <p className="issue-drawer__unavailable">
            {link.key} could not be read from {TRACKER_LABELS[link.tracker]} right now. It is still
            attached to {projectName}.
          </p>
        ) : (
          <>
            <h2 className="issue-drawer__title">{issue.title}</h2>
            <div className="issue-drawer__meta">
              <span className="issue-drawer__tag">{TRACKER_LABELS[link.tracker]}</span>
              <span className="issue-drawer__tag">{issue.assignee?.name ?? 'Unassigned'}</span>
              {issue.labels.map((label) => (
                <span key={label} className="issue-drawer__tag">
                  {label}
                </span>
              ))}
              {issue.updatedAt !== '' && (
                <span className="issue-drawer__tag">updated {relative(issue.updatedAt)}</span>
              )}
            </div>
          </>
        )}
      </header>

      {issue !== null && (
        <section className="issue-drawer__section">
          {issue.description.trim().length > 0 ? (
            <IssueMarkdown>{issue.description}</IssueMarkdown>
          ) : (
            <p className="issue-drawer__empty">No description.</p>
          )}
        </section>
      )}

      {issue !== null && issue.comments.length > 0 && (
        <section className="issue-drawer__section">
          <h3 className="issue-drawer__heading">
            Comments <span className="issue-drawer__count">{issue.comments.length}</span>
          </h3>
          {issue.comments.map((c, i) => (
            <div key={`${c.author}-${c.createdAt}-${i}`} className="issue-drawer__comment">
              <span className="issue-drawer__who">
                {c.author} · {relative(c.createdAt)}
              </span>
              <IssueMarkdown>{c.body}</IssueMarkdown>
            </div>
          ))}
        </section>
      )}

      <section className="issue-drawer__section">
        <h3 className="issue-drawer__heading">
          Agent session context
          {context !== null && (
            <span className={`issue-drawer__counter${counterClass}`}>
              {context.chars.toLocaleString()} / {CONTEXT_LIMIT.toLocaleString()}
            </span>
          )}
        </h3>
        {context === null ? (
          <p className="issue-drawer__empty">Nothing is fed to agent sessions on this branch.</p>
        ) : (
          <>
            <pre className="issue-drawer__context">{context.markdown}</pre>
            {context.truncated && (
              <p className="issue-drawer__truncated">
                Shortened to fit — the full issue is linked at the end of it.
              </p>
            )}
          </>
        )}
        <label className="issue-drawer__toggle">
          <input
            type="checkbox"
            checked={link.injectContext}
            onChange={(e) => void toggleInjection(e.target.checked)}
          />
          Feed this issue to agent sessions in {projectName}
        </label>
      </section>

      <section className="issue-drawer__section">
        <h3 className="issue-drawer__heading">Comment</h3>
        <textarea
          className="issue-drawer__textarea"
          value={commentText}
          placeholder={`Add a comment to ${link.key}…`}
          onChange={(e) => setCommentText(e.target.value)}
        />
        {error !== null && (
          <p className="issue-drawer__error" role="alert">
            {error}
          </p>
        )}
        <div className="issue-drawer__actions">
          <button
            className="ext-btn"
            disabled={busy || commentText.trim().length === 0}
            onClick={() => void comment()}
          >
            {busy ? 'Working…' : 'Post comment'}
          </button>
          <button
            className="ext-btn ext-btn--danger"
            onClick={() => {
              void unlinkIssue(projectId)
              onClose()
            }}
          >
            Unlink {link.key}
          </button>
        </div>
      </section>
    </aside>
  )
}
