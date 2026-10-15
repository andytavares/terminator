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
import { ExternalLink, RefreshCw, X } from 'lucide-react'
import { plural } from '@terminator/extension-sdk'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { useLoadIssueComments } from '../../hooks/usePrReview'
import { githubAPI } from '../../api/github'
import { mergeFlowAPI } from '../../api/merge-flow'
import { RichContent } from './RichContent'
import { OverviewSummary, summaryShown, useSummary, type Summary } from './OverviewSummary'
import { ReadinessStrip, type ReadinessBranch } from './ReadinessStrip'
import { ReviewPlan } from './ReviewPlan'
import { PropertiesRail } from './PropertiesRail'
import { overviewTotals } from './overview-signals'
import './pr-overview.css'
import type { PrReviewDetail, IssueComment } from '../../schemas/pr-review.schema'
import { choose } from '../text'

interface Props {
  repoRoot: string
  pr: PrReviewDetail
  sessionStatus: 'not-started' | 'in-progress' | 'paused'
  onStartReview: (chapterId?: string) => void
  onClose: () => void
  onRefresh?: () => Promise<void>
  onPopOut?: () => void
  onStartMergeFlow?: (worktreePath: string) => void
}

type SessionStatus = Props['sessionStatus']

const START_LABEL: Record<SessionStatus, string> = {
  'not-started': 'Start review',
  'in-progress': 'Continue review',
  paused: 'Resume review',
}

/** "Start review", or "Resume review · 3 of 9 viewed" for a review already under way. */
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

interface HeaderProps {
  props: Props
  actions: OverviewActions
  label: string
}

function HeaderTitle({ pr }: { pr: PrReviewDetail }) {
  return (
    <h1 className="pr-overview-title">
      <span
        className={`pr-overview-state pr-overview-state--${choose(pr.isDraft, 'draft', 'open')}`}
      >
        {choose(pr.isDraft, 'Draft', 'Open')}
      </span>
      {pr.title} <span className="pr-overview-number">#{pr.number}</span>
    </h1>
  )
}

function HeaderMeta({ pr }: { pr: PrReviewDetail }) {
  const { fileCount, additions, deletions, minutes } = overviewTotals(pr)
  return (
    <div className="pr-overview-meta" role="group" aria-label="Pull request summary">
      <strong>{pr.author}</strong>
      <span>
        <code className="pr-overview-ref">{pr.headRefName}</code> →{' '}
        <code className="pr-overview-ref">{pr.baseRefName}</code>
      </span>
      <span>
        opened <RelativeTime value={pr.openedAt} />
      </span>
      <span>
        {fileCount} {plural(fileCount, 'file')}
      </span>
      <span>
        <b className="pr-overview-added">+{additions}</b>{' '}
        <b className="pr-overview-removed">−{deletions}</b>
      </span>
      <span>about {minutes} min</span>
    </div>
  )
}

function ReviewActions({ props, actions, label }: HeaderProps) {
  return (
    <>
      {props.pr.isDraft && (
        <Button onClick={actions.handleMarkReady} disabled={actions.markReady.busy}>
          {choose(actions.markReady.busy, 'Marking ready…', 'Mark as ready')}
        </Button>
      )}
      <Button variant="primary" onClick={() => props.onStartReview()}>
        {label}
      </Button>
    </>
  )
}

function IconActions({ props, actions }: Omit<HeaderProps, 'label'>) {
  const { refresh } = actions
  return (
    <>
      <IconButton
        icon={RefreshCw}
        className={choose(refresh.busy, 'pr-refresh-btn--spinning', undefined)}
        onClick={actions.handleRefresh}
        disabled={refresh.busy}
        label="Reload pull request"
      />
      {props.onPopOut && (
        <IconButton icon={ExternalLink} label="Open in focused window" onClick={props.onPopOut} />
      )}
      <IconButton icon={X} label="Close" onClick={props.onClose} />
    </>
  )
}

function OverviewHeader(header: HeaderProps) {
  return (
    <header className="pr-overview-header">
      <div className="pr-overview-heading">
        <HeaderTitle pr={header.props.pr} />
        <HeaderMeta pr={header.props.pr} />
      </div>
      <div className="pr-overview-actions" role="group" aria-label="Pull request actions">
        <IconActions props={header.props} actions={header.actions} />
        <span className="pr-overview-review-actions">
          <ReviewActions {...header} />
        </span>
      </div>
    </header>
  )
}

/** Narrow panes move the review actions here (see pr-overview.css); the header hides its copy. */
function OverviewFooter(footer: HeaderProps) {
  return (
    <footer className="pr-overview-footer" role="group" aria-label="Review actions">
      <ReviewActions {...footer} />
    </footer>
  )
}

function Reading({ pr, clamped }: { pr: PrReviewDetail; clamped: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const clamp = clamped && !expanded
  return (
    <>
      <div className={`pr-overview-reading${clamp ? ' pr-overview-reading--clamped' : ''}`}>
        <RichContent>{pr.body}</RichContent>
      </div>
      {clamped && (
        <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
          {choose(expanded, 'Show less', 'Show full description')}
        </Button>
      )}
    </>
  )
}

function DescriptionSection({ pr, clamped }: { pr: PrReviewDetail; clamped: boolean }) {
  return (
    <section className="pr-overview-section">
      <div className="pr-overview-section-head">
        <h2>Description</h2>
        {pr.body && <span className="pr-overview-byline">{pr.author} wrote</span>}
      </div>
      {!pr.body && <p className="pr-overview-no-desc">No description provided.</p>}
      {pr.body && <Reading pr={pr} clamped={clamped} />}
    </section>
  )
}

interface OverviewBodyProps {
  repoRoot: string
  pr: PrReviewDetail
  comments: IssueComment[]
  box: IssueCommentBox
  composerRef: ComposerRef
  onStartReview: Props['onStartReview']
}

function OverviewTabContent(props: OverviewBodyProps & { summary: Summary }) {
  const { pr, summary } = props
  return (
    <div className="pr-overview-layout">
      <div className="pr-overview-column">
        <OverviewSummary subject={{ kind: 'description', body: pr.body }} summary={summary} />
        <ReviewPlan chapters={pr.chapters} onStartAt={props.onStartReview} />
        <DescriptionSection pr={pr} clamped={summaryShown(summary)} />
      </div>
      <PropertiesRail pr={pr} />
    </div>
  )
}

type CommentProps = { comment: IssueComment; onReply: (comment: IssueComment) => void }

function IssueCommentHeader({ comment, onReply }: CommentProps) {
  return (
    <div className="pr-issue-comment-header">
      <strong className="inline-comment-author">{comment.author}</strong>
      <time className="inline-comment-time" dateTime={comment.createdAt}>
        <RelativeTime value={comment.createdAt} />
      </time>
      <Button variant="ghost" size="sm" onClick={() => onReply(comment)}>
        Reply
      </Button>
    </div>
  )
}

function IssueCommentItem(props: CommentProps) {
  const { comment } = props
  return (
    <div className="pr-issue-comment">
      <img
        src={comment.authorAvatarUrl}
        alt={comment.author}
        className="pr-issue-comment-avatar"
        width={26}
        height={26}
      />
      <div>
        <IssueCommentHeader {...props} />
        <div className="pr-issue-comment-body">
          <RichContent>{comment.body}</RichContent>
        </div>
      </div>
    </div>
  )
}

/** The discussion as a timeline. Its Brief sits above it, compact, so it never hides the thread. */
function DiscussionContent(props: OverviewBodyProps & { summary: Summary }) {
  const { comments, box } = props
  return (
    <div className="pr-overview-layout pr-overview-layout--single">
      <div className="pr-overview-column">
        <OverviewSummary subject={{ kind: 'discussion', comments }} summary={props.summary} />
        {comments.length > 0 && (
          <div className="pr-issue-comment-list">
            {comments.map((comment) => (
              <IssueCommentItem key={comment.id} comment={comment} onReply={box.handleReply} />
            ))}
          </div>
        )}
        <DiscussionComposer box={box} composerRef={props.composerRef} />
      </div>
    </div>
  )
}

/** Overview and Discussion, one at a time. Each summary lives here, so it outlasts a tab switch
 *  and goes with the overview. */
function OverviewTabs(props: OverviewBodyProps) {
  const [tab, setTab] = useState<'overview' | 'discussion'>('overview')
  const descriptionSummary = useSummary(props.repoRoot, props.pr.number)
  const discussionSummary = useSummary(props.repoRoot, props.pr.number)
  return (
    <div className="pr-overview-main">
      <TabsRoot selectedId={tab} onSelect={setTab}>
        <TabList label="Pull request sections" className="pr-overview-tabs">
          <Tab id="overview">Overview</Tab>
          <Tab id="discussion">Discussion · {props.comments.length}</Tab>
        </TabList>
        <TabPanel id="overview" className="pr-overview-tab-panel">
          <OverviewTabContent {...props} summary={descriptionSummary} />
        </TabPanel>
        <TabPanel id="discussion" className="pr-overview-tab-panel">
          <DiscussionContent {...props} summary={discussionSummary} />
        </TabPanel>
      </TabsRoot>
    </div>
  )
}

/** Loads the pull request's conversation when it opens and when another pull request replaces it. */
function useLoadOnOpen(load: (prNumber: number) => Promise<void>, prNumber: number) {
  useEffect(() => {
    load(prNumber)
  }, [load, prNumber])
}

function countFiles(pr: PrReviewDetail): number {
  return pr.chapters.reduce((n, c) => n + c.files.length, 0)
}

function branchOf(actions: OverviewActions): ReadinessBranch {
  return {
    updating: actions.update.busy,
    resolving: actions.merge.busy,
    error: actions.update.error ?? actions.merge.error,
    onUpdate: actions.handleUpdateBranch,
    onResolve: actions.handleResolveConflicts,
  }
}

export function PrOverviewPanel(props: Props) {
  const { repoRoot, pr } = props
  const { viewedFiles, issueComments, currentUserLogin } = usePrReviewStore()
  const loadIssueComments = useLoadIssueComments(repoRoot)
  const actions = useOverviewActions(props, loadIssueComments)
  const { box, composerRef } = useIssueComment(props, loadIssueComments)
  useLoadOnOpen(loadIssueComments, pr.number)
  const label = startLabel(props.sessionStatus, viewedFiles.size, countFiles(pr))
  return (
    <div className="pr-overview">
      <OverviewHeader props={props} actions={actions} label={label} />
      <ReadinessStrip
        pr={pr}
        youAreRequested={isRequestedOf(pr, currentUserLogin)}
        branch={branchOf(actions)}
      />
      <OverviewTabs
        key={pr.number}
        repoRoot={repoRoot}
        pr={pr}
        comments={issueComments}
        box={box}
        composerRef={composerRef}
        onStartReview={props.onStartReview}
      />
      <OverviewFooter props={props} actions={actions} label={label} />
    </div>
  )
}
