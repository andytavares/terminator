import { useShallow } from 'zustand/react/shallow'
import React, { useEffect, useState } from 'react'
import { ExternalLink, RefreshCw, X } from 'lucide-react'
import { Button } from '@terminator/extension-ui'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { TRACKER_LABELS } from './use-issue-search'
import { CommentsSection, IssueDescriptionSection, IssueTags } from './issue-sections'
import type { AgentContext, Issue, IssueLink } from '../../../shared/types/index'
import './IssueDrawer.css'

// The attached issue, read without leaving the app.
//
// The last block is the one that matters: the literal text an agent session
// will receive, with its size against the runtime's cap. What the operator
// inspects here is produced by the same function that writes the file a
// session reads — not a second rendering of the same idea (FR-023).

const CONTEXT_LIMIT = 10_000
/** Where the counter starts warning: close enough that trimming is imminent. */
const CONTEXT_WARN_AT = 0.85

export interface IssueDrawerProps {
  projectId: string
  projectName: string
  onClose: () => void
}

export function IssueDrawer({ projectId, projectName, onClose }: IssueDrawerProps): JSX.Element {
  const { link, issue } = useIntegrationsStore(
    useShallow((s) => ({ link: s.linkFor(projectId), issue: s.issueFor(projectId) }))
  )
  const context = useContextPreview(projectId, issue)
  const actions = useDrawerActions(projectId)

  if (link === null) return <></>
  return (
    <aside className="issue-drawer" aria-label={`Issue ${link.key}`}>
      <DrawerHeader {...{ link, issue, projectName, onClose }} actions={actions} />
      {issue !== null && <IssueDescriptionSection issue={issue} />}
      {issue !== null && issue.comments.length > 0 && <CommentsSection issue={issue} />}
      <ContextSection {...{ link, context, projectName }} actions={actions} />
      <CommentSection
        link={link}
        actions={actions}
        onUnlink={() => unlinkAndClose(projectId, onClose)}
      />
    </aside>
  )
}

function unlinkAndClose(projectId: string, onClose: () => void): void {
  void useIntegrationsStore.getState().unlinkIssue(projectId)
  onClose()
}

/** The literal text an agent session on this branch would receive, read again whenever the issue
 * does. */
function useContextPreview(projectId: string, issue: Issue | null): AgentContext | null {
  const [context, setContext] = useState<AgentContext | null>(null)
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
  return context
}

/** Refreshing, commenting and the injection toggle, with what is busy and what failed. */
function useDrawerActions(projectId: string) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [commentText, setCommentText] = useState('')
  const reloadLink = (): Promise<void> => useIntegrationsStore.getState().loadLink(projectId)
  const whileBusy = async (run: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    await run()
  }
  const effects = { setBusy, setError, setCommentText, reload: reloadLink }
  return {
    busy,
    error,
    commentText,
    setCommentText,
    refresh: (link: IssueLink) =>
      whileBusy(async () => {
        await window.electronAPI.integrations.getIssue({ ...trackerKey(link), refresh: true })
        await reloadLink()
        setBusy(false)
      }),
    comment: (link: IssueLink) => whileBusy(() => postIssueComment(link, commentText, effects)),
    toggleInjection: (next: boolean) => setInjection(projectId, next, effects),
  }
}

async function setInjection(
  projectId: string,
  injectContext: boolean,
  { setError, reload }: Pick<CommentEffects, 'setError' | 'reload'>
): Promise<void> {
  const result = await window.electronAPI.integrations.setInjectContext({
    projectId,
    injectContext,
  })
  if ('error' in result) return setError(result.message ?? 'Could not change that setting.')
  await reload()
}

type DrawerActions = ReturnType<typeof useDrawerActions>

const trackerKey = (link: IssueLink) => ({ tracker: link.tracker, key: link.key })

interface CommentEffects {
  setBusy: (busy: boolean) => void
  setError: (error: string | null) => void
  setCommentText: (text: string) => void
  reload: () => Promise<void>
}

async function postIssueComment(
  link: IssueLink,
  text: string,
  effects: CommentEffects
): Promise<void> {
  const result = await window.electronAPI.integrations.comment({
    ...trackerKey(link),
    body: text.trim(),
  })
  effects.setBusy(false)
  if ('error' in result) {
    // Their words stay in the box. Losing what someone just typed because a
    // token expired is the worst possible response to a failed write.
    effects.setError(result.message ?? 'Could not post that comment.')
    return
  }
  effects.setCommentText('')
  await effects.reload()
}

interface HeaderProps {
  link: IssueLink
  issue: Issue | null
  projectName: string
  onClose: () => void
  actions: DrawerActions
}

/** The key and state with Refresh, Open and Close; then the title and tags, or why there are none. */
function DrawerHeader({ link, issue, projectName, onClose, actions }: HeaderProps): JSX.Element {
  return (
    <header className="issue-drawer__top">
      <div className="issue-drawer__key-row">
        <span className="issue-drawer__key">{link.key}</span>
        {issue !== null && <span className="issue-drawer__state">{issue.state.name}</span>}
        <HeaderButtons {...{ link, issue, onClose, actions }} />
      </div>
      {issue === null ? (
        <p className="issue-drawer__unavailable">
          {link.key} could not be read from {TRACKER_LABELS[link.tracker]} right now. It is still
          attached to {projectName}.
        </p>
      ) : (
        <>
          <h2 className="issue-drawer__title">{issue.title}</h2>
          <IssueTags issue={issue} tracker={link.tracker} />
        </>
      )}
    </header>
  )
}

function HeaderButtons({ link, issue, onClose, actions }: Omit<HeaderProps, 'projectName'>) {
  return (
    <div className="issue-drawer__top-actions">
      <button
        className="issue-drawer__icon-btn"
        title="Refresh"
        disabled={actions.busy}
        onClick={() => void actions.refresh(link)}
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
  )
}

interface ContextSectionProps {
  link: IssueLink
  context: AgentContext | null
  projectName: string
  actions: DrawerActions
}

/** What agent sessions are fed, its size against the cap, and the switch that feeds it. */
function ContextSection({ link, context, projectName, actions }: ContextSectionProps) {
  return (
    <section className="issue-drawer__section">
      <h3 className="issue-drawer__heading">
        Agent session context
        {context !== null && <ContextCounter chars={context.chars} />}
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
          onChange={(e) => void actions.toggleInjection(e.target.checked)}
        />
        Feed this issue to agent sessions in {projectName}
      </label>
    </section>
  )
}

function ContextCounter({ chars }: { chars: number }): JSX.Element {
  const warn = chars / CONTEXT_LIMIT >= CONTEXT_WARN_AT ? ' issue-drawer__counter--warn' : ''
  return (
    <span className={`issue-drawer__counter${warn}`}>
      {chars.toLocaleString()} / {CONTEXT_LIMIT.toLocaleString()}
    </span>
  )
}

interface CommentSectionProps {
  link: IssueLink
  actions: DrawerActions
  onUnlink: () => void
}

/** The comment box, any failure, Post comment and Unlink. */
function CommentSection({ link, actions, onUnlink }: CommentSectionProps): JSX.Element {
  const { busy, error, commentText } = actions
  return (
    <section className="issue-drawer__section">
      <h3 className="issue-drawer__heading">Comment</h3>
      <textarea
        className="issue-drawer__textarea"
        value={commentText}
        placeholder={`Add a comment to ${link.key}…`}
        onChange={(e) => actions.setCommentText(e.target.value)}
      />
      {error !== null && (
        <p className="issue-drawer__error" role="alert">
          {error}
        </p>
      )}
      <div className="issue-drawer__actions">
        <Button
          variant="primary"
          disabled={busy || commentText.trim().length === 0}
          onClick={() => void actions.comment(link)}
        >
          {busy ? 'Working…' : 'Post comment'}
        </Button>
        <UnlinkButton issueKey={link.key} onUnlink={onUnlink} />
      </div>
    </section>
  )
}

function UnlinkButton({ issueKey, onUnlink }: { issueKey: string; onUnlink: () => void }) {
  return (
    <Button variant="danger" onClick={onUnlink}>
      Unlink {issueKey}
    </Button>
  )
}
