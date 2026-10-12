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

export function PrOverviewPanel({
  repoRoot,
  pr,
  sessionStatus,
  onStartReview,
  onClose,
  onRefresh,
  onPopOut,
  onStartMergeFlow,
}: Props) {
  const { viewedFiles, issueComments, currentUserLogin } = usePrReviewStore()
  const loadIssueComments = useLoadIssueComments(repoRoot)
  const [commentBody, setCommentBody] = useState('')
  const [commentTab, setCommentTab] = useState<'write' | 'preview'>('write')
  const [submitting, setSubmitting] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [markingReady, setMarkingReady] = useState(false)
  const [updatingBranch, setUpdatingBranch] = useState(false)
  const [updateBranchError, setUpdateBranchError] = useState<string | null>(null)
  const [preparingMerge, setPreparingMerge] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await Promise.all([onRefresh?.(), loadIssueComments(pr.number)])
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadIssueComments(pr.number)
  }, [loadIssueComments, pr.number])

  const totalFiles = pr.chapters.reduce((n, c) => n + c.files.length, 0)
  const viewedCount = viewedFiles.size
  const isResume = sessionStatus === 'in-progress' || sessionStatus === 'paused'
  const [discussionOpen, setDiscussionOpen] = useState(false)
  const [issueRefsExpanded, setIssueRefsExpanded] = useState(true)

  const youAreRequested =
    !!currentUserLogin &&
    (pr.requestedReviewers?.includes(currentUserLogin) ||
      pr.assigneeLogins?.includes(currentUserLogin))
  const startLabel =
    (sessionStatus === 'paused' ? 'Resume Review' : isResume ? 'Continue Review' : 'Start Review') +
    (isResume && totalFiles > 0 ? ` · ${viewedCount} of ${totalFiles} viewed` : '')

  const handleMarkReady = async () => {
    setMarkingReady(true)
    try {
      await githubAPI.prMarkReady(repoRoot, pr.number)
      await onRefresh?.()
    } finally {
      setMarkingReady(false)
    }
  }

  const handleUpdateBranch = async () => {
    setUpdatingBranch(true)
    setUpdateBranchError(null)
    try {
      const result = await githubAPI.prUpdateBranch(repoRoot, pr.number)
      if (result && typeof result === 'object' && 'error' in result) {
        setUpdateBranchError(String((result as { error: string }).error))
      } else {
        await onRefresh?.()
      }
    } catch (e) {
      setUpdateBranchError(String(e))
    } finally {
      setUpdatingBranch(false)
    }
  }

  const handleResolveConflicts = async () => {
    setPreparingMerge(true)
    setMergeError(null)
    try {
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
      if ('error' in mergeResult) {
        setMergeError(`Could not prepare merge: ${mergeResult.error}`)
        return
      }
      if (!mergeResult.hasConflicts) {
        setMergeError('No conflicts found — the PR may already be clean.')
        return
      }

      onStartMergeFlow?.(worktreePath)
    } catch (e) {
      setMergeError(String(e))
    } finally {
      setPreparingMerge(false)
    }
  }

  const handleReply = (comment: IssueComment) => {
    const quoted = comment.body
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
    setCommentBody(`${quoted}\n\n`)
    setTimeout(() => {
      composerRef.current?.focus()
      const len = composerRef.current?.value.length ?? 0
      composerRef.current?.setSelectionRange(len, len)
    }, 0)
  }

  const handleCommentSubmit = async () => {
    if (!commentBody.trim()) return
    setSubmitting(true)
    setCommentError(null)
    try {
      const result = await githubAPI.prIssueCommentAdd({
        repoRoot,
        prNumber: pr.number,
        body: commentBody,
      })
      if ('error' in result) throw new Error((result as { error: string }).error)
      setCommentBody('')
      await loadIssueComments(pr.number)
    } catch (e) {
      setCommentError(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="pr-overview">
      <div className="pr-review-topbar">
        <span className="pr-review-topbar-title">
          <span className="pr-overview-pr-num">#{pr.number}</span>
          {pr.isDraft && <span className="pr-draft-badge">Draft</span>} {pr.title}
        </span>
        <div className="pr-review-topbar-actions">
          <IconButton
            icon={RefreshCw}
            className={refreshing ? 'pr-refresh-btn--spinning' : undefined}
            onClick={handleRefresh}
            disabled={refreshing}
            label="Reload pull request"
          />
          {onPopOut && (
            <Button
              variant="ghost"
              size="sm"
              icon={ExternalLink}
              onClick={onPopOut}
              title="Open in focused window"
            >
              Pop out
            </Button>
          )}
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
      </div>

      <div className="pr-overview-body-scroll">
        <section className="pr-overview-block pr-overview-status" aria-label="Status">
          <StatusChecksBar checks={pr.statusChecks ?? []} detailed />
          <div className="pr-overview-meta">
            {pr.approvals && pr.approvals.length > 0 && (
              <span className="pr-overview-approvals-label">
                Approved by {pr.approvals.map((a) => a.author).join(', ')}
              </span>
            )}
            {pr.requestedReviewers && pr.requestedReviewers.length > 0 && (
              <span className="pr-overview-approvals-label pr-overview-approvals-label--pending">
                {pr.approvals && pr.approvals.length > 0 ? 'Awaiting' : 'Review requested from'}{' '}
                {pr.requestedReviewers.join(', ')}
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
            <span className="pr-overview-meta-author">{pr.author}</span>
            <span className="pr-overview-meta-branch">
              {pr.headRefName} → {pr.baseRefName}
            </span>
            <RelativeTime value={pr.openedAt} />
            {pr.mergeStateStatus === 'behind' && (
              <span className="pr-merge-state-badge pr-merge-state-badge--behind">
                <ArrowDown aria-hidden="true" /> Behind {pr.baseRefName}
              </span>
            )}
            {pr.mergeStateStatus === 'dirty' && (
              <span className="pr-merge-state-badge pr-merge-state-badge--dirty">
                <TriangleAlert aria-hidden="true" /> Conflicts
              </span>
            )}
          </div>
        </section>

        <section className="pr-overview-block">
          <InsightsPanel pr={pr} />
        </section>

        {/* Issue context */}
        {pr.issueRefs && pr.issueRefs.length > 0 && (
          <div className="pr-overview-block">
            <h3
              className="pr-overview-section-title pr-overview-section-title--collapsible"
              onClick={() => setIssueRefsExpanded((v) => !v)}
              role="button"
              aria-expanded={issueRefsExpanded}
            >
              Context
              <span className="pr-overview-section-toggle">
                {issueRefsExpanded ? (
                  <ChevronDown aria-hidden="true" />
                ) : (
                  <ChevronRight aria-hidden="true" />
                )}
              </span>
            </h3>
            {issueRefsExpanded && (
              <ul className="pr-overview-issue-refs">
                {pr.issueRefs.map((ref, i) => (
                  <li key={i} className="pr-overview-issue-ref">
                    {ref.url ? (
                      <a
                        href={ref.url}
                        onClick={(e) => {
                          e.preventDefault()
                          if (ref.url)
                            window.electronAPI.shell.openExternal(ref.url).catch(() => {})
                        }}
                        className="pr-overview-issue-ref-link"
                      >
                        {ref.ref}
                      </a>
                    ) : (
                      <span className="pr-overview-issue-ref-label">{ref.ref}</span>
                    )}
                    {ref.title !== undefined && (
                      <span className="pr-overview-issue-ref-title">{ref.title}</span>
                    )}
                    {ref.state !== undefined && (
                      <span className="pr-overview-issue-ref-state">{ref.state}</span>
                    )}
                    <span className="pr-overview-issue-ref-type">{ref.type}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* PR description */}
        {pr.body ? (
          <div className="pr-overview-block">
            <h3 className="pr-overview-section-title">Description</h3>
            <div className="pr-overview-description">
              <RichContent>{pr.body}</RichContent>
            </div>
          </div>
        ) : (
          <div className="pr-overview-block pr-overview-no-desc">No description provided.</div>
        )}

        {/* Discussion */}
        <div className="pr-overview-block">
          <button
            className="pr-overview-section-title pr-overview-discussion-toggle"
            onClick={() => setDiscussionOpen((v) => !v)}
            aria-expanded={discussionOpen}
          >
            Discussion · {issueComments.length}
            <span className="pr-overview-section-toggle">
              {discussionOpen ? (
                <ChevronDown aria-hidden="true" />
              ) : (
                <ChevronRight aria-hidden="true" />
              )}
            </span>
          </button>

          {discussionOpen && issueComments.length > 0 && (
            <div className="pr-issue-comment-list">
              {issueComments.map((comment) => (
                <IssueCommentItem key={comment.id} comment={comment} onReply={handleReply} />
              ))}
            </div>
          )}

          {discussionOpen && (
            <div className="comment-composer pr-issue-composer">
              <TabsRoot selectedId={commentTab} onSelect={setCommentTab}>
                <TabList label="Comment">
                  <Tab id="write">Write</Tab>
                  <Tab id="preview">Preview</Tab>
                </TabList>
                <TabPanel id="write">
                  <textarea
                    ref={composerRef}
                    className="comment-composer-textarea"
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    placeholder="Leave a comment…"
                    rows={4}
                    disabled={submitting}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCommentSubmit()
                    }}
                  />
                </TabPanel>
                <TabPanel id="preview">
                  <div className="comment-composer-preview">
                    {commentBody.trim() ? (
                      <RichContent>{commentBody}</RichContent>
                    ) : (
                      <em>Nothing to preview.</em>
                    )}
                  </div>
                </TabPanel>
              </TabsRoot>

              {commentError && <p className="comment-composer-error">{commentError}</p>}
              <div className="comment-composer-actions">
                <span className="pr-issue-composer-hint">⌘↵ to submit</span>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleCommentSubmit}
                  disabled={submitting || !commentBody.trim()}
                >
                  {submitting ? 'Submitting…' : 'Comment'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CTA */}
      <div className="pr-overview-cta">
        {updateBranchError && <p className="pr-update-branch-error">{updateBranchError}</p>}
        {mergeError && <p className="pr-update-branch-error">{mergeError}</p>}
        {pr.mergeStateStatus === 'behind' && (
          <Button
            icon={updatingBranch ? undefined : ArrowDown}
            onClick={handleUpdateBranch}
            disabled={updatingBranch}
          >
            {updatingBranch ? 'Updating…' : `Update from ${pr.baseRefName}`}
          </Button>
        )}
        {pr.mergeStateStatus === 'dirty' && (
          <Button
            variant="danger"
            icon={preparingMerge ? undefined : ArrowRight}
            onClick={handleResolveConflicts}
            disabled={preparingMerge}
          >
            {preparingMerge ? 'Preparing merge…' : 'Resolve conflicts'}
          </Button>
        )}
        {pr.isDraft && (
          <Button onClick={handleMarkReady} disabled={markingReady}>
            {markingReady ? 'Marking ready…' : 'Mark as Ready'}
          </Button>
        )}
        <Button variant="primary" onClick={onStartReview}>
          {startLabel}
        </Button>
      </div>
    </div>
  )
}

function IssueCommentItem({
  comment,
  onReply,
}: {
  comment: IssueComment
  onReply: (comment: IssueComment) => void
}) {
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
        <Button variant="ghost" size="sm" onClick={() => onReply(comment)}>
          Reply
        </Button>
      </div>
      <div className="pr-issue-comment-body">
        <RichContent>{comment.body}</RichContent>
      </div>
    </div>
  )
}
