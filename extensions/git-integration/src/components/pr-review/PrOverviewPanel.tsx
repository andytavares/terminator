import React, { useEffect, useRef, useState } from 'react'
import { Eye } from 'lucide-react'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { useGitStore } from '../../stores/git.store'
import { useExtensionRegistry } from '../../../../../src/renderer/extensions/registry'
import { useLoadIssueComments } from '../../hooks/usePrReview'
import { githubAPI } from '../../api/github'
import { mergeFlowAPI } from '../../api/merge-flow'
import { useToastStore } from '../../../../../src/renderer/stores/toast.store'
import { useWorkspaceStore } from '../../../../../src/renderer/stores/workspace.store'
import { StatusChecksBar } from './StatusChecksBar'
import { RichContent } from './RichContent'
import type { PrReviewDetail, IssueComment } from '../../schemas/pr-review.schema'

interface Props {
  repoRoot: string
  pr: PrReviewDetail
  sessionStatus: 'not-started' | 'in-progress' | 'paused'
  onStartReview: () => void
  onClose: () => void
  onRefresh?: () => Promise<void>
  onPopOut?: () => void
}

const CI_LABEL: Record<PrReviewDetail['ciStatus'], string> = {
  passing: 'Passing',
  failing: 'Failing',
  pending: 'Pending',
  none: 'No CI',
}

export function PrOverviewPanel({
  repoRoot,
  pr,
  sessionStatus,
  onStartReview,
  onClose,
  onRefresh,
  onPopOut,
}: Props) {
  const { viewedFiles, issueComments, currentUserLogin } = usePrReviewStore()
  const { setView } = useGitStore()
  const { setActiveProjectTab } = useExtensionRegistry()
  const { addToast } = useToastStore()
  const { activeWorkspaceId, createProject, setActiveProject } = useWorkspaceStore()
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

  const allFiles = pr.chapters.flatMap((c) => c.files)
  const totalFiles = allFiles.length
  const totalAdditions = allFiles.reduce((s, f) => s + f.additions, 0)
  const totalDeletions = allFiles.reduce((s, f) => s + f.deletions, 0)
  const totalMinutes = pr.chapters.reduce((s, c) => s + c.estimatedMinutes, 0)

  const highFiles = allFiles.filter((f) => f.riskScore.level === 'high')
  const medFiles = allFiles.filter((f) => f.riskScore.level === 'medium')
  const lowFiles = allFiles.filter((f) => f.riskScore.level === 'low')

  const hotspots = [...allFiles]
    .filter((f) => f.riskScore.composite != null && f.riskScore.level !== 'low')
    .sort((a, b) => (b.riskScore.composite ?? 0) - (a.riskScore.composite ?? 0))
    .slice(0, 6)

  const viewedCount = viewedFiles.size
  const reviewPct = totalFiles > 0 ? Math.round((viewedCount / totalFiles) * 100) : 0
  const isResume = sessionStatus === 'in-progress' || sessionStatus === 'paused'
  const [issueRefsExpanded, setIssueRefsExpanded] = useState(true)

  const age = formatAge(pr.openedAt)
  const startLabel =
    sessionStatus === 'paused' ? 'Resume Review' : isResume ? 'Continue Review' : 'Start Review'

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
    if (!activeWorkspaceId) {
      addToast({ type: 'error', message: 'No active workspace — open a project first.' })
      return
    }
    setPreparingMerge(true)
    try {
      // Get a safe path for the new worktree
      const { path: worktreePath } = await window.electronAPI.git.suggestWorktreePath(
        repoRoot,
        pr.headRefName
      )

      // Create the worktree + run git merge to produce conflict markers
      const mergeResult = await mergeFlowAPI.preparePrWorktree(
        repoRoot,
        worktreePath,
        pr.headRefName,
        pr.baseRefName
      )
      if ('error' in mergeResult) {
        addToast({ type: 'error', message: `Could not prepare merge: ${mergeResult.error}` })
        return
      }
      if (!mergeResult.hasConflicts) {
        addToast({
          type: 'error',
          message: 'No conflicts found after merge — the PR may already be clean.',
        })
        return
      }

      // Register the worktree as a project so it shows in the sidebar
      const shortName = pr.headRefName.split('/').pop() ?? pr.headRefName
      const projectResult = await createProject({
        workspaceId: activeWorkspaceId,
        name: `${shortName} (conflicts)`,
        worktreePath,
        gitBranch: pr.headRefName,
        isWorktree: true,
      })
      if ('error' in projectResult) {
        addToast({
          type: 'error',
          message: `Could not add conflict project: ${(projectResult as { error: string }).error}`,
        })
        return
      }

      // Switch to the new project and open the conflict resolver
      setActiveProject(projectResult.project.id)
      setView('merge-flow')
      setActiveProjectTab('git')
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
          <button
            className={`pr-refresh-btn${refreshing ? ' pr-refresh-btn--spinning' : ''}`}
            onClick={handleRefresh}
            disabled={refreshing}
            title="Reload PR"
            aria-label="Reload pull request"
          >
            ↻
          </button>
          {onPopOut && (
            <button
              className="pr-review-popout-btn"
              onClick={onPopOut}
              title="Open in focused window"
            >
              ⬡ Pop out
            </button>
          )}
          <button className="pr-review-close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      </div>

      <div className="pr-overview-meta">
        <span className="pr-overview-meta-author">{pr.author}</span>
        <span className="pr-overview-meta-sep">·</span>
        <span>{age}</span>
        <span className="pr-overview-meta-sep">·</span>
        <span className="pr-overview-meta-branch">
          {pr.headRefName} → {pr.baseRefName}
        </span>
        {currentUserLogin &&
          (pr.requestedReviewers?.includes(currentUserLogin) ||
            pr.assigneeLogins?.includes(currentUserLogin)) && (
            <span
              className="pr-overview-your-review-badge"
              title="You have been requested to review this PR"
            >
              <Eye size={11} strokeWidth={2} />
              Your review requested
            </span>
          )}
        {pr.mergeStateStatus === 'behind' && (
          <span className="pr-merge-state-badge pr-merge-state-badge--behind">
            ↓ Behind {pr.baseRefName}
          </span>
        )}
        {pr.mergeStateStatus === 'dirty' && (
          <span className="pr-merge-state-badge pr-merge-state-badge--dirty">⚠ Conflicts</span>
        )}
      </div>

      <StatusChecksBar checks={pr.statusChecks ?? []} defaultExpanded={true} />

      {((pr.approvals && pr.approvals.length > 0) ||
        (pr.requestedReviewers && pr.requestedReviewers.length > 0)) && (
        <div className="pr-overview-approvals-bar">
          {pr.approvals && pr.approvals.length > 0 && (
            <>
              <span className="pr-overview-approvals-label">Approved by</span>
              {pr.approvals.map((approval) => (
                <span
                  key={approval.author}
                  className="pr-overview-approver"
                  title={approval.author}
                >
                  <img
                    src={approval.authorAvatarUrl}
                    alt={approval.author}
                    className="pr-overview-approver-avatar"
                    width={16}
                    height={16}
                  />
                  <span className="pr-overview-approver-name">{approval.author}</span>
                </span>
              ))}
            </>
          )}
          {pr.requestedReviewers && pr.requestedReviewers.length > 0 && (
            <>
              <span className="pr-overview-approvals-label pr-overview-approvals-label--pending">
                {pr.approvals && pr.approvals.length > 0 ? 'Awaiting' : 'Review requested from'}
              </span>
              {pr.requestedReviewers.map((reviewer) => (
                <span
                  key={reviewer}
                  className="pr-overview-approver pr-overview-approver--pending"
                  title={reviewer}
                >
                  <span className="pr-overview-approver-name">{reviewer}</span>
                </span>
              ))}
            </>
          )}
        </div>
      )}

      <div className="pr-overview-body-scroll">
        {/* Metrics row */}
        <div className="pr-overview-metrics">
          <div className="pr-overview-metric">
            <span className="pr-overview-metric-value">{totalFiles}</span>
            <span className="pr-overview-metric-label">Files</span>
          </div>
          <div className="pr-overview-metric">
            <span className="pr-overview-metric-value pr-overview-metric-value--add">
              +{totalAdditions}
            </span>
            <span className="pr-overview-metric-label">Additions</span>
          </div>
          <div className="pr-overview-metric">
            <span className="pr-overview-metric-value pr-overview-metric-value--del">
              −{totalDeletions}
            </span>
            <span className="pr-overview-metric-label">Deletions</span>
          </div>
          <div className="pr-overview-metric">
            <span className="pr-overview-metric-value">{totalMinutes}m</span>
            <span className="pr-overview-metric-label">Est. time</span>
          </div>
          <div className="pr-overview-metric">
            <span className={`pr-overview-metric-value pr-overview-ci--${pr.ciStatus}`}>
              {CI_LABEL[pr.ciStatus]}
            </span>
            <span className="pr-overview-metric-label">CI</span>
          </div>
        </div>

        {/* Risk distribution */}
        <div className="pr-overview-risk-row">
          <div className="pr-overview-risk-dist">
            <span className="pr-risk-chip pr-risk-chip--high">{highFiles.length} high</span>
            <span className="pr-risk-chip pr-risk-chip--medium">{medFiles.length} med</span>
            <span className="pr-risk-chip pr-risk-chip--low">{lowFiles.length} low</span>
          </div>
          {isResume && totalFiles > 0 && (
            <div className="pr-overview-progress-inline">
              <span className="pr-overview-progress-label">
                {viewedCount}/{totalFiles} reviewed
              </span>
              <div className="pr-overview-progress-track">
                <div className="pr-overview-progress-fill" style={{ width: `${reviewPct}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* Hotspots */}
        {hotspots.length > 0 && (
          <div className="pr-overview-section">
            <h3 className="pr-overview-section-title">Hotspots — focus here first</h3>
            <ul className="pr-overview-hotspot-list">
              {hotspots.map((f) => (
                <li
                  key={f.path}
                  className={`pr-overview-hotspot-item pr-overview-hotspot-item--${f.riskScore.level}`}
                >
                  <span className={`pr-risk-chip pr-risk-chip--${f.riskScore.level}`}>
                    {f.riskScore.level === 'high' ? 'HIGH' : 'MED'}
                  </span>
                  <span className="pr-overview-hotspot-path" title={f.path}>
                    {formatShortPath(f.path)}
                  </span>
                  <span className="pr-overview-hotspot-score">
                    {f.riskScore.composite ?? '?'}/100
                  </span>
                  <span className="pr-overview-hotspot-driver" title={f.riskScore.dominantDriver}>
                    {f.riskScore.dominantDriver}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Issue context */}
        {pr.issueRefs && pr.issueRefs.length > 0 && (
          <div className="pr-overview-section">
            <h3
              className="pr-overview-section-title pr-overview-section-title--collapsible"
              onClick={() => setIssueRefsExpanded((v) => !v)}
              role="button"
              aria-expanded={issueRefsExpanded}
            >
              Context
              <span className="pr-overview-section-toggle">{issueRefsExpanded ? '▾' : '▸'}</span>
            </h3>
            {issueRefsExpanded && (
              <ul className="pr-overview-issue-refs">
                {pr.issueRefs.map((ref, i) => (
                  <li key={i} className="pr-overview-issue-ref">
                    {ref.type === 'linear' && ref.url ? (
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
                    <span className="pr-overview-issue-ref-type">{ref.type}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* PR description */}
        {pr.body ? (
          <div className="pr-overview-section">
            <h3 className="pr-overview-section-title">Description</h3>
            <div className="pr-overview-description">
              <RichContent>{pr.body}</RichContent>
            </div>
          </div>
        ) : (
          <div className="pr-overview-section pr-overview-no-desc">No description provided.</div>
        )}

        {/* Discussion */}
        <div className="pr-overview-section">
          <h3 className="pr-overview-section-title">
            Discussion
            {issueComments.length > 0 && (
              <span className="pr-overview-comment-count"> · {issueComments.length}</span>
            )}
          </h3>

          {issueComments.length > 0 && (
            <div className="pr-issue-comment-list">
              {issueComments.map((comment) => (
                <IssueCommentItem key={comment.id} comment={comment} onReply={handleReply} />
              ))}
            </div>
          )}

          <div className="comment-composer pr-issue-composer">
            <div className="comment-composer-tabs">
              <button
                className={`comment-composer-tab${commentTab === 'write' ? ' comment-composer-tab--active' : ''}`}
                onClick={() => setCommentTab('write')}
              >
                Write
              </button>
              <button
                className={`comment-composer-tab${commentTab === 'preview' ? ' comment-composer-tab--active' : ''}`}
                onClick={() => setCommentTab('preview')}
              >
                Preview
              </button>
            </div>

            {commentTab === 'write' ? (
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
            ) : (
              <div className="comment-composer-preview">
                {commentBody.trim() ? (
                  <RichContent>{commentBody}</RichContent>
                ) : (
                  <em>Nothing to preview.</em>
                )}
              </div>
            )}

            {commentError && <p className="comment-composer-error">{commentError}</p>}
            <div className="comment-composer-actions">
              <span className="pr-issue-composer-hint">⌘↵ to submit</span>
              <button
                className="comment-composer-submit"
                onClick={handleCommentSubmit}
                disabled={submitting || !commentBody.trim()}
              >
                {submitting ? 'Submitting…' : 'Comment'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="pr-overview-cta">
        {updateBranchError && <p className="pr-update-branch-error">{updateBranchError}</p>}
        {pr.mergeStateStatus === 'behind' && (
          <button
            className="pr-overview-update-branch-btn"
            onClick={handleUpdateBranch}
            disabled={updatingBranch}
          >
            {updatingBranch ? 'Updating…' : `↓ Update from ${pr.baseRefName}`}
          </button>
        )}
        {pr.mergeStateStatus === 'dirty' && (
          <button
            className="pr-overview-resolve-conflicts-btn"
            onClick={handleResolveConflicts}
            disabled={preparingMerge}
          >
            {preparingMerge ? 'Preparing merge…' : 'Resolve conflicts →'}
          </button>
        )}
        {pr.isDraft && (
          <button
            className="pr-overview-ready-btn"
            onClick={handleMarkReady}
            disabled={markingReady}
          >
            {markingReady ? 'Marking ready…' : 'Mark as Ready'}
          </button>
        )}
        <button className="pr-overview-start-btn" onClick={onStartReview}>
          {startLabel}
        </button>
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
          {formatCommentTime(comment.createdAt)}
        </time>
        <button className="pr-issue-comment-reply-btn" onClick={() => onReply(comment)}>
          Reply
        </button>
      </div>
      <div className="pr-issue-comment-body">
        <RichContent>{comment.body}</RichContent>
      </div>
    </div>
  )
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return '1d ago'
  return `${days}d ago`
}

function formatCommentTime(iso: string): string {
  try {
    const d = new Date(iso)
    const ms = Date.now() - d.getTime()
    const mins = Math.floor(ms / 60_000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 14) return `${days}d ago`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

function formatShortPath(path: string): string {
  const parts = path.split('/')
  if (parts.length <= 2) return path
  return `…/${parts.slice(-2).join('/')}`
}
