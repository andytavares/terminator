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
import { ArrowDown, ArrowRight, ExternalLink, Eye, RefreshCw, TriangleAlert, X } from 'lucide-react'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { useLoadIssueComments } from '../../hooks/usePrReview'
import { githubAPI } from '../../api/github'
import { mergeFlowAPI } from '../../api/merge-flow'
import { StatusChecksBar } from './StatusChecksBar'
import { RichContent } from './RichContent'
import { InsightsPanel } from './InsightsPanel'
import { OverviewSummary, useSummary, type Summary } from './OverviewSummary'
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
  const runWhileBusy = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }
  return { busy, run: runWhileBusy }
}

/** Like useBusyFlag, and keeps the problem `action` reports, or the error it throws. */
function useBusyAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const runReportingError = async (action: () => Promise<string | null>) => {
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
  return { busy, error, run: runReportingError }
}

type BusyFlag = ReturnType<typeof useBusyFlag>

async function updateBranchFromBase(props: Props): Promise<string | null> {
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
    handleUpdateBranch: () => update.run(() => updateBranchFromBase(props)),
    handleResolveConflicts: () => merge.run(() => resolveConflicts(props)),
  }
}

type OverviewActions = ReturnType<typeof useOverviewActions>

/** Posts the comment to the PR's conversation, then reloads it; throws what GitHub refused. */
async function postPullRequestComment(props: Props, body: string): Promise<void> {
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
      await postPullRequestComment(props, commentBody)
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

/** Approvals, pending requests and your own request, or that nobody was asked. */
function ReviewersRow({ pr, youAreRequested }: { pr: PrReviewDetail; youAreRequested: boolean }) {
  const anyone =
    (pr.approvals?.length ?? 0) > 0 || (pr.requestedReviewers?.length ?? 0) > 0 || youAreRequested
  if (!anyone) return <span className="pr-glance-none">None requested</span>
  return <Reviewers pr={pr} youAreRequested={youAreRequested} />
}

const SETTLED_MERGE_STATE: Record<'clean' | 'unknown', string> = {
  clean: 'No conflicts',
  unknown: 'Not reported',
}

function MergeStateBadge({ pr }: { pr: PrReviewDetail }) {
  if (pr.mergeStateStatus === 'behind') {
    return (
      <span className="pr-merge-state-badge pr-merge-state-badge--behind">
        <ArrowDown aria-hidden="true" /> Behind {pr.baseRefName}
      </span>
    )
  }
  if (pr.mergeStateStatus !== 'dirty') {
    return <span className="pr-glance-none">{SETTLED_MERGE_STATE[pr.mergeStateStatus]}</span>
  }
  return (
    <span className="pr-merge-state-badge pr-merge-state-badge--dirty">
      <TriangleAlert aria-hidden="true" /> Conflicts
    </span>
  )
}

function GlanceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pr-glance-row">
      <dt className="pr-glance-label">{label}</dt>
      <dd className="pr-glance-value">{children}</dd>
    </div>
  )
}

function ChecksRow({ pr }: { pr: PrReviewDetail }) {
  const checks = pr.statusChecks ?? []
  if (checks.length === 0) return <span className="pr-glance-none">No checks</span>
  return <StatusChecksBar detailed checks={checks} />
}

/** The facts a reviewer checks before reading: status, people, branch and linked issues. */
function AtAGlance({ pr, youAreRequested }: { pr: PrReviewDetail; youAreRequested: boolean }) {
  const issueRefs = pr.issueRefs ?? []
  return (
    <aside className="pr-glance" aria-label="At a glance">
      <dl className="pr-glance-list">
        <GlanceRow label="Checks">
          <ChecksRow pr={pr} />
        </GlanceRow>
        <GlanceRow label="Reviewers">
          <ReviewersRow pr={pr} youAreRequested={youAreRequested} />
        </GlanceRow>
        <GlanceRow label="Author">{pr.author}</GlanceRow>
        <GlanceRow label="Branch">
          {pr.headRefName} → {pr.baseRefName}
        </GlanceRow>
        <GlanceRow label="Opened">
          <RelativeTime value={pr.openedAt} />
        </GlanceRow>
        <GlanceRow label="Merge state">
          <MergeStateBadge pr={pr} />
        </GlanceRow>
        {issueRefs.length > 0 && <LinkedIssuesRow issueRefs={issueRefs} />}
      </dl>
    </aside>
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

function LinkedIssuesRow({ issueRefs }: { issueRefs: IssueRef[] }) {
  return (
    <GlanceRow label="Linked issues">
      <ul className="pr-overview-issue-refs">
        {issueRefs.map((ref, i) => (
          <IssueRefItem key={i} issueRef={ref} />
        ))}
      </ul>
    </GlanceRow>
  )
}

function DescriptionPanel({ pr, summary }: { pr: PrReviewDetail; summary: Summary }) {
  if (!pr.body) return <p className="pr-overview-no-desc">No description provided.</p>
  return (
    <>
      <OverviewSummary subject={{ kind: 'description', body: pr.body }} summary={summary} />
      <div className="pr-overview-description">
        <RichContent>{pr.body}</RichContent>
      </div>
    </>
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

function IssueComposerTabs({
  box,
  composerRef,
}: {
  box: IssueCommentBox
  composerRef: ComposerRef
}) {
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
      <IssueComposerTabs box={box} composerRef={composerRef} />
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
  summary: Summary
}

function DiscussionPanel({ comments, box, composerRef, summary }: DiscussionProps) {
  return (
    <>
      <OverviewSummary subject={{ kind: 'discussion', comments }} summary={summary} />
      {comments.length > 0 && (
        <div className="pr-issue-comment-list">
          {comments.map((comment) => (
            <IssueCommentItem key={comment.id} comment={comment} onReply={box.handleReply} />
          ))}
        </div>
      )}
      <DiscussionComposer box={box} composerRef={composerRef} />
    </>
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

interface OverviewBodyProps {
  repoRoot: string
  pr: PrReviewDetail
  comments: IssueComment[]
  box: IssueCommentBox
  composerRef: ComposerRef
  youAreRequested: boolean
}

type OverviewTab = 'description' | 'discussion' | 'insights'

/** Description, Discussion and Insights, one at a time. Each summary lives here, so it outlasts a
 *  tab switch and goes with the overview. */
function OverviewTabs(props: OverviewBodyProps) {
  const [tab, setTab] = useState<OverviewTab>('description')
  const descriptionSummary = useSummary(props.repoRoot, props.pr.number)
  const discussionSummary = useSummary(props.repoRoot, props.pr.number)
  return (
    <div className="pr-overview-main">
      <TabsRoot selectedId={tab} onSelect={setTab}>
        <TabList label="Pull request sections" className="pr-overview-tabs">
          <Tab id="description">Description</Tab>
          <Tab id="discussion">Discussion · {props.comments.length}</Tab>
          <Tab id="insights">Insights</Tab>
        </TabList>
        <TabPanel id="description" className="pr-overview-tab-panel">
          <DescriptionPanel pr={props.pr} summary={descriptionSummary} />
        </TabPanel>
        <TabPanel id="discussion" className="pr-overview-tab-panel">
          <DiscussionPanel {...props} summary={discussionSummary} />
        </TabPanel>
        <TabPanel id="insights" className="pr-overview-tab-panel">
          <InsightsPanel pr={props.pr} />
        </TabPanel>
      </TabsRoot>
    </div>
  )
}

function OverviewBody(props: OverviewBodyProps) {
  return (
    <div className="pr-overview-body">
      <AtAGlance pr={props.pr} youAreRequested={props.youAreRequested} />
      <OverviewTabs key={props.pr.number} {...props} />
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
        repoRoot={repoRoot}
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
