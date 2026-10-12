import React, { useEffect, useRef, useState } from 'react'
import {
  Button,
  IconButton,
  RelativeTime,
  Tab,
  TabList,
  TabPanel,
  TabsRoot,
} from '@terminator/extension-ui'
import {
  ArrowDown,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  RefreshCw,
  TriangleAlert,
  X,
} from 'lucide-react'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { useLoadIssueComments } from '../../hooks/usePrReview'
import { githubAPI } from '../../api/github'
import { mergeFlowAPI } from '../../api/merge-flow'
import { StatusChecksBar } from './StatusChecksBar'
import { RichContent } from './RichContent'
import { InsightsPanel } from './InsightsPanel'
import type { PrReviewDetail, IssueComment } from '../../schemas/pr-review.schema'
import { choose } from '../text'

interface Props {
  repoRoot: string
  pr: PrReviewDetail
  sessionStatus: 'not-started' | 'in-progress' | 'paused'
  onStartReview: () => void
  onClose: () => void
  onRefresh?: () => Promise<void>
  onPopOut?: () => void
  onStartMergeFlow?: (worktreePath: string) => void
}

type SessionStatus = Props['sessionStatus']
type IssueRef = NonNullable<PrReviewDetail['issueRefs']>[number]

const START_LABEL: Record<SessionStatus, string> = {
  'not-started': 'Start Review',
  'in-progress': 'Continue Review',
  paused: 'Resume Review',
}

/** "Start Review", or "Resume Review · 3 of 9 viewed" for a review already under way. */
function startLabel(status: SessionStatus, viewedCount: number, totalFiles: number): string {
  const base = START_LABEL[status]
  if (status === 'not-started' || totalFiles === 0) return base
  return `${base} · ${viewedCount} of ${totalFiles} viewed`
}

function isRequestedOf(pr: PrReviewDetail, login: string | null): boolean {
  if (!login) return false
  return Boolean(pr.requestedReviewers?.includes(login) || pr.assigneeLogins?.includes(login))
}

/** `> `-quoted text to reply under, with a blank line for the answer. */
function quoteForReply(body: string): string {
  const quoted = body
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  return `${quoted}\n\n`
}

/** A flag that is set while `action` runs. */
function useBusyFlag() {
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

/** Like useBusyFlag, and keeps the problem `action` reports, or the error it throws. */
function useBusyAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (action: () => Promise<string | null>) => {
    setBusy(true)
    setError(null)
    try {
      setError(await action())
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

type BusyFlag = ReturnType<typeof useBusyFlag>

async function updateBranch(props: Props): Promise<string | null> {
  const result = await githubAPI.prUpdateBranch(props.repoRoot, props.pr.number)
  if (result && typeof result === 'object' && 'error' in result) {
    return String((result as { error: string }).error)
  }
  await props.onRefresh?.()
  return null
}

/** Merges the base into a worktree of the PR's branch and opens the merge flow on its conflicts. */
async function resolveConflicts(props: Props): Promise<string | null> {
  const { repoRoot, pr } = props
  const { path: worktreePath } = await window.electronAPI.git.suggestWorktreePath(
    repoRoot,
    pr.headRefName
  )
  const mergeResult = await mergeFlowAPI.preparePrWorktree({
    repoRoot,
    worktreePath,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
  })
  if ('error' in mergeResult) return `Could not prepare merge: ${mergeResult.error}`
  if (!mergeResult.hasConflicts) return 'No conflicts found — the PR may already be clean.'
  props.onStartMergeFlow?.(worktreePath)
  return null
}

function useOverviewActions(props: Props, loadIssueComments: (prNumber: number) => Promise<void>) {
  const refresh = useBusyFlag()
  const markReady = useBusyFlag()
  const update = useBusyAction()
  const merge = useBusyAction()
  const { repoRoot, pr, onRefresh } = props
  return {
    refresh,
    markReady,
    update,
    merge,
    handleRefresh: () =>
      refresh.run(() => Promise.all([onRefresh?.(), loadIssueComments(pr.number)])),
    handleMarkReady: () =>
      markReady.run(async () => {
        await githubAPI.prMarkReady(repoRoot, pr.number)
        await onRefresh?.()
      }),
    handleUpdateBranch: () => update.run(() => updateBranch(props)),
    handleResolveConflicts: () => merge.run(() => resolveConflicts(props)),
  }
}

type OverviewActions = ReturnType<typeof useOverviewActions>

/** Posts the comment to the PR's conversation, then reloads it; throws what GitHub refused. */
async function postIssueComment(props: Props, body: string): Promise<void> {
  const result = await githubAPI.prIssueCommentAdd({
    repoRoot: props.repoRoot,
    prNumber: props.pr.number,
    body,
  })
  if ('error' in result) throw new Error((result as { error: string }).error)
}

/** The discussion's comment box: its text, tab, sending state and the reply-by-quoting action. */
function useIssueComment(props: Props, loadIssueComments: (prNumber: number) => Promise<void>) {
  const [commentBody, setCommentBody] = useState('')
  const [commentTab, setCommentTab] = useState<'write' | 'preview'>('write')
  const send = useBusyAction()
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const handleCommentSubmit = async () => {
    if (!commentBody.trim()) return
    await send.run(async () => {
      await postIssueComment(props, commentBody)
      setCommentBody('')
      await loadIssueComments(props.pr.number)
      return null
    })
  }
  const handleReply = (comment: IssueComment) => {
    setCommentBody(quoteForReply(comment.body))
    setTimeout(() => focusAtEnd(composerRef.current), 0)
  }
  const box = {
    commentBody,
    setCommentBody,
    commentTab,
    setCommentTab,
    submitting: send.busy,
    commentError: send.error,
    handleCommentSubmit,
    handleReply,
  }
  return { box, composerRef }
}

type IssueCommentBox = ReturnType<typeof useIssueComment>['box']
type ComposerRef = React.RefObject<HTMLTextAreaElement>

function focusAtEnd(box: HTMLTextAreaElement | null): void {
  box?.focus()
  const len = box?.value.length ?? 0
  box?.setSelectionRange(len, len)
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span className="pr-overview-section-toggle">
      {open && <ChevronDown aria-hidden="true" />}
      {!open && <ChevronRight aria-hidden="true" />}
    </span>
  )
}

interface TopBarProps {
  props: Props
  refresh: BusyFlag
  onRefresh: () => void
}

function TopBarActions(bar: TopBarProps) {
  const { props, refresh } = bar
  return (
    <div className="pr-review-topbar-actions">
      <IconButton
        icon={RefreshCw}
        className={choose(refresh.busy, 'pr-refresh-btn--spinning', undefined)}
        onClick={bar.onRefresh}
        disabled={refresh.busy}
        label="Reload pull request"
      />
      {props.onPopOut && (
        <Button
          variant="ghost"
          size="sm"
          icon={ExternalLink}
          onClick={props.onPopOut}
          title="Open in focused window"
        >
          Pop out
        </Button>
      )}
      <IconButton icon={X} label="Close" onClick={props.onClose} />
    </div>
  )
}

function OverviewTopBar(bar: TopBarProps) {
  const { pr } = bar.props
  return (
    <div className="pr-review-topbar">
      <span className="pr-review-topbar-title">
        <span className="pr-overview-pr-num">#{pr.number}</span>
        {pr.isDraft && <span className="pr-draft-badge">Draft</span>} {pr.title}
      </span>
      <TopBarActions props={bar.props} refresh={bar.refresh} onRefresh={bar.onRefresh} />
    </div>
  )
}

function Reviewers({ pr, youAreRequested }: { pr: PrReviewDetail; youAreRequested: boolean }) {
  const approved = (pr.approvals?.length ?? 0) > 0
  const requested = pr.requestedReviewers ?? []
  return (
    <>
      {approved && (
        <span className="pr-overview-approvals-label">
          Approved by {(pr.approvals ?? []).map((a) => a.author).join(', ')}
        </span>
      )}
      {requested.length > 0 && (
        <span className="pr-overview-approvals-label pr-overview-approvals-label--pending">
          {choose(approved, 'Awaiting', 'Review requested from')} {requested.join(', ')}
        </span>
      )}
      {youAreRequested && (
        <span
          className="pr-overview-your-review-badge"
          title="You have been requested to review this PR"
        >
          <Eye aria-hidden="true" />
          Your review requested
        </span>
      )}
    </>
  )
}

function MergeStateBadge({ pr }: { pr: PrReviewDetail }) {
  if (pr.mergeStateStatus === 'behind') {
    return (
      <span className="pr-merge-state-badge pr-merge-state-badge--behind">
        <ArrowDown aria-hidden="true" /> Behind {pr.baseRefName}
      </span>
    )
  }
  if (pr.mergeStateStatus !== 'dirty') return null
  return (
    <span className="pr-merge-state-badge pr-merge-state-badge--dirty">
      <TriangleAlert aria-hidden="true" /> Conflicts
    </span>
  )
}

function StatusBlock({ pr, youAreRequested }: { pr: PrReviewDetail; youAreRequested: boolean }) {
  const checks = pr.statusChecks ?? []
  return (
    <section className="pr-overview-block pr-overview-status" aria-label="Status">
      <StatusChecksBar detailed checks={checks} />
      <div className="pr-overview-meta">
        <Reviewers pr={pr} youAreRequested={youAreRequested} />
        <span className="pr-overview-meta-author">{pr.author}</span>
        <span className="pr-overview-meta-branch">
          {pr.headRefName} → {pr.baseRefName}
        </span>
        <RelativeTime value={pr.openedAt} />
        <MergeStateBadge pr={pr} />
      </div>
    </section>
  )
}

function IssueRefName({ issueRef }: { issueRef: IssueRef }) {
  const { url } = issueRef
  if (!url) return <span className="pr-overview-issue-ref-label">{issueRef.ref}</span>
  return (
    <a
      href={url}
      onClick={(e) => {
        e.preventDefault()
        window.electronAPI.shell.openExternal(url).catch(() => {})
      }}
      className="pr-overview-issue-ref-link"
    >
      {issueRef.ref}
    </a>
  )
}

function IssueRefItem({ issueRef }: { issueRef: IssueRef }) {
  return (
    <li className="pr-overview-issue-ref">
      <IssueRefName issueRef={issueRef} />
      {issueRef.title !== undefined && (
        <span className="pr-overview-issue-ref-title">{issueRef.title}</span>
      )}
      {issueRef.state !== undefined && (
        <span className="pr-overview-issue-ref-state">{issueRef.state}</span>
      )}
      <span className="pr-overview-issue-ref-type">{issueRef.type}</span>
    </li>
  )
}

function IssueContext({ issueRefs }: { issueRefs: IssueRef[] }) {
  const [expanded, setExpanded] = useState(true)
  return (
    <div className="pr-overview-block">
      <h3
        aria-expanded={expanded}
        className="pr-overview-section-title pr-overview-section-title--collapsible"
        onClick={() => setExpanded((v) => !v)}
        role="button"
      >
        Context
        <Chevron open={expanded} />
      </h3>
      {expanded && (
        <ul className="pr-overview-issue-refs">
          {issueRefs.map((ref, i) => (
            <IssueRefItem key={i} issueRef={ref} />
          ))}
        </ul>
      )}
    </div>
  )
}

function Description({ body }: { body: string | null | undefined }) {
  if (!body)
    return <div className="pr-overview-block pr-overview-no-desc">No description provided.</div>
  return (
    <div className="pr-overview-block">
      <h3 className="pr-overview-section-title">Description</h3>
      <div className="pr-overview-description">
        <RichContent>{body}</RichContent>
      </div>
    </div>
  )
}

function WriteBox({ box, composerRef }: { box: IssueCommentBox; composerRef: ComposerRef }) {
  return (
    <textarea
      ref={composerRef}
      className="comment-composer-textarea"
      value={box.commentBody}
      onChange={(e) => box.setCommentBody(e.target.value)}
      placeholder="Leave a comment…"
      rows={4}
      disabled={box.submitting}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) box.handleCommentSubmit()
      }}
    />
  )
}

function ComposerTabs({ box, composerRef }: { box: IssueCommentBox; composerRef: ComposerRef }) {
  const { commentBody } = box
  return (
    <TabsRoot selectedId={box.commentTab} onSelect={box.setCommentTab}>
      <TabList label="Comment">
        <Tab id="write">Write</Tab>
        <Tab id="preview">Preview</Tab>
      </TabList>
      <TabPanel id="write">
        <WriteBox box={box} composerRef={composerRef} />
      </TabPanel>
      <TabPanel id="preview">
        <div className="comment-composer-preview">
          {commentBody.trim() && <RichContent>{commentBody}</RichContent>}
          {!commentBody.trim() && <em>Nothing to preview.</em>}
        </div>
      </TabPanel>
    </TabsRoot>
  )
}

function DiscussionComposer({
  box,
  composerRef,
}: {
  box: IssueCommentBox
  composerRef: ComposerRef
}) {
  return (
    <div className="comment-composer pr-issue-composer">
      <ComposerTabs box={box} composerRef={composerRef} />
      {box.commentError && <p className="comment-composer-error">{box.commentError}</p>}
      <div className="comment-composer-actions">
        <span className="pr-issue-composer-hint">⌘↵ to submit</span>
        <Button
          variant="primary"
          size="sm"
          onClick={box.handleCommentSubmit}
          disabled={box.submitting || !box.commentBody.trim()}
        >
          {choose(box.submitting, 'Submitting…', 'Comment')}
        </Button>
      </div>
    </div>
  )
}

interface DiscussionProps {
  comments: IssueComment[]
  box: IssueCommentBox
  composerRef: ComposerRef
}

function Discussion({ comments, box, composerRef }: DiscussionProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="pr-overview-block">
      <button
        aria-expanded={open}
        className="pr-overview-section-title pr-overview-discussion-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        Discussion · {comments.length}
        <Chevron open={open} />
      </button>
      {open && comments.length > 0 && (
        <div className="pr-issue-comment-list">
          {comments.map((comment) => (
            <IssueCommentItem key={comment.id} comment={comment} onReply={box.handleReply} />
          ))}
        </div>
      )}
      {open && <DiscussionComposer box={box} composerRef={composerRef} />}
    </div>
  )
}

function BranchButtons({ pr, actions }: { pr: PrReviewDetail; actions: OverviewActions }) {
  const { update, merge } = actions
  return (
    <>
      {pr.mergeStateStatus === 'behind' && (
        <Button
          icon={choose(update.busy, undefined, ArrowDown)}
          onClick={actions.handleUpdateBranch}
          disabled={update.busy}
        >
          {choose(update.busy, 'Updating…', `Update from ${pr.baseRefName}`)}
        </Button>
      )}
      {pr.mergeStateStatus === 'dirty' && (
        <Button
          variant="danger"
          icon={choose(merge.busy, undefined, ArrowRight)}
          onClick={actions.handleResolveConflicts}
          disabled={merge.busy}
        >
          {choose(merge.busy, 'Preparing merge…', 'Resolve conflicts')}
        </Button>
      )}
    </>
  )
}

function CtaBar(props: {
  pr: PrReviewDetail
  actions: OverviewActions
  startLabel: string
  onStartReview: () => void
}) {
  const { pr, actions } = props
  return (
    <div className="pr-overview-cta">
      {actions.update.error && <p className="pr-update-branch-error">{actions.update.error}</p>}
      {actions.merge.error && <p className="pr-update-branch-error">{actions.merge.error}</p>}
      <BranchButtons pr={pr} actions={actions} />
      {pr.isDraft && (
        <Button onClick={actions.handleMarkReady} disabled={actions.markReady.busy}>
          {choose(actions.markReady.busy, 'Marking ready…', 'Mark as Ready')}
        </Button>
      )}
      <Button variant="primary" onClick={props.onStartReview}>
        {props.startLabel}
      </Button>
    </div>
  )
}

function OverviewBody(props: {
  pr: PrReviewDetail
  comments: IssueComment[]
  box: IssueCommentBox
  composerRef: ComposerRef
  youAreRequested: boolean
}) {
  const { pr } = props
  return (
    <div className="pr-overview-body-scroll">
      <StatusBlock pr={pr} youAreRequested={props.youAreRequested} />
      <section className="pr-overview-block">
        <InsightsPanel pr={pr} />
      </section>
      {pr.issueRefs && pr.issueRefs.length > 0 && <IssueContext issueRefs={pr.issueRefs} />}
      <Description body={pr.body} />
      <Discussion comments={props.comments} box={props.box} composerRef={props.composerRef} />
    </div>
  )
}

export function PrOverviewPanel(props: Props) {
  const { repoRoot, pr } = props
  const { viewedFiles, issueComments, currentUserLogin } = usePrReviewStore()
  const loadIssueComments = useLoadIssueComments(repoRoot)
  const actions = useOverviewActions(props, loadIssueComments)
  const { box, composerRef } = useIssueComment(props, loadIssueComments)
  useEffect(() => {
    loadIssueComments(pr.number)
  }, [loadIssueComments, pr.number])
  const totalFiles = pr.chapters.reduce((n, c) => n + c.files.length, 0)
  return (
    <div className="pr-overview">
      <OverviewTopBar props={props} refresh={actions.refresh} onRefresh={actions.handleRefresh} />
      <OverviewBody
        pr={pr}
        comments={issueComments}
        box={box}
        composerRef={composerRef}
        youAreRequested={isRequestedOf(pr, currentUserLogin)}
      />
      <CtaBar
        pr={pr}
        actions={actions}
        startLabel={startLabel(props.sessionStatus, viewedFiles.size, totalFiles)}
        onStartReview={props.onStartReview}
      />
    </div>
  )
}

function IssueCommentItem(props: {
  comment: IssueComment
  onReply: (comment: IssueComment) => void
}) {
  const { comment } = props
  return (
    <div className="pr-issue-comment">
      <div className="pr-issue-comment-header">
        <img
          src={comment.authorAvatarUrl}
          alt={comment.author}
          className="inline-comment-avatar"
          width={20}
          height={20}
        />
        <strong className="inline-comment-author">{comment.author}</strong>
        <time className="inline-comment-time" dateTime={comment.createdAt}>
          <RelativeTime value={comment.createdAt} />
        </time>
        <Button variant="ghost" size="sm" onClick={() => props.onReply(comment)}>
          Reply
        </Button>
      </div>
      <div className="pr-issue-comment-body">
        <RichContent>{comment.body}</RichContent>
      </div>
    </div>
  )
}
