import React, { useState, useEffect, useRef } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { useReviewUiStore } from '../../stores/review-ui.store'
import { sortPrs } from '../../review/sort-prs'
import { SortSelect } from './SortSelect'
import type { ReviewQueuePR } from '../../schemas/pr-review.schema'
import { DiffSize, RowMeta, shortAge } from './DiffSize'
import './review-dashboard.css'

interface Props {
  repoRoot: string
  onOpenPr: (pr: ReviewQueuePR) => void
  onRefresh: (options?: { search?: string }) => Promise<void>
  onDismissPr: (prNumber: number) => Promise<void>
}

export function ReviewQueue({ repoRoot: _repoRoot, onOpenPr, onRefresh, onDismissPr }: Props) {
  const {
    prQueue,
    queueLoading,
    loadingMorePrs,
    queueError,
    rateLimitState,
    totalPrCount,
    currentUserLogin,
  } = usePrReviewStore()
  const { queueSort, setQueueSort } = useReviewUiStore()
  const [refreshing, setRefreshing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(false)

  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true
      return
    }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      onRefresh({ search: searchQuery.trim() || undefined })
    }, 350)
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [searchQuery, onRefresh])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await onRefresh({ search: searchQuery.trim() || undefined })
    } finally {
      setRefreshing(false)
    }
  }

  const sorted = sortPrs(prQueue, queueSort)

  // Reading time is only knowable for the PRs actually loaded, so it is
  // stated as a floor rather than passed off as the total when more remain.
  const totalMinutes = prQueue.reduce((s, p) => s + p.estimatedMinutes, 0)
  const minutesArePartial = totalPrCount !== null && totalPrCount > prQueue.length
  const highRiskCount = prQueue.filter((p) => p.riskLevel === 'high').length
  const inProgressCount = prQueue.filter((p) => p.sessionStatus !== 'not-started').length

  return (
    <div className="pr-review-queue">
      {rateLimitState && (
        <div className="pr-rate-limit-banner">
          GitHub API rate limit reached. Some data may be incomplete. Resets soon.
        </div>
      )}

      {queueError && (
        <div className="pr-queue-error">
          Failed to load queue: {queueError}
          <button className="pr-refresh-btn" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {/* One line of triage, not four tiles.
          Two of the four routinely read "0" — half the row spent saying nothing
          is wrong — and two of the labels carried instructions inside them
          ("High risk — read these first"). A label names a metric; telling you
          what to do with it belongs in the grouping below, which already does. */}
      <div className="rd-band">
        <span>
          <b>{totalPrCount ?? prQueue.length}</b> waiting on you
        </span>
        {highRiskCount > 0 && <span className="rd-warn">{highRiskCount} high risk</span>}
        {inProgressCount > 0 && <span>{inProgressCount} already started</span>}
        <span>
          {minutesArePartial ? 'At least ' : 'About '}
          <b>{totalMinutes} min</b> of reading
        </span>
        <span className="rd-sp" />
        <button
          className={`pr-refresh-btn${refreshing ? ' pr-refresh-btn--spinning' : ''}`}
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh pull requests"
          aria-label="Refresh pull requests"
        >
          <RefreshCw aria-hidden="true" />
        </button>
      </div>

      <div className="pr-search-row">
        <input
          className="pr-search-input"
          type="search"
          placeholder="Search open PRs · is:merged for merged"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search pull requests"
        />
        <SortSelect value={queueSort} onChange={setQueueSort} />
      </div>

      {/* Sections */}
      <div className="pr-sections">
        {queueLoading ? (
          <div className="pr-queue-loading">Loading pull requests…</div>
        ) : prQueue.length === 0 ? (
          <div className="pr-queue-empty">
            {searchQuery ? 'No matching pull requests.' : 'No open pull requests.'}
          </div>
        ) : (
          <div className="rd-rows">
            <h3 className="rd-grp">
              <span>Open pull requests</span>
              <span className="rd-ct">{totalPrCount ?? prQueue.length}</span>
            </h3>
            {sorted.map((pr) => (
              <PrRow
                key={pr.number}
                pr={pr}
                onOpen={onOpenPr}
                onDismiss={onDismissPr}
                currentUserLogin={currentUserLogin}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pages arrive on their own; this only says so while one is in flight. */}
      {loadingMorePrs && !searchQuery && <p className="pr-loading-rest">Loading the rest…</p>}
    </div>
  )
}

function PrRow({
  pr,
  onOpen,
  onDismiss,
  currentUserLogin,
}: {
  pr: ReviewQueuePR
  onOpen: (pr: ReviewQueuePR) => void
  onDismiss?: (prNumber: number) => Promise<void>
  currentUserLogin: string | null
}) {
  const isSession = pr.sessionStatus === 'paused' || pr.sessionStatus === 'in-progress'
  // A control says what happens when it is used: every one of these opens the diff.
  const actionLabel =
    pr.sessionStatus === 'paused'
      ? 'Resume'
      : pr.sessionStatus === 'in-progress'
        ? 'Continue'
        : 'Review'
  const mine =
    currentUserLogin !== null &&
    (pr.requestedReviewers.includes(currentUserLogin) ||
      pr.assigneeLogins.includes(currentUserLogin))
  const open = () => onOpen(pr)

  return (
    <div
      className="rd-row rd-row--clickable"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter') open()
      }}
    >
      <span className="rd-ti">
        <span className="rd-t1">
          <span className="rd-no">#{pr.number}</span> <span>{pr.title}</span>
        </span>
        <RowMeta
          parts={[
            pr.state === 'merged' && { text: 'Merged' },
            pr.state === 'closed' && { text: 'Closed' },
            pr.isDraft && { text: 'Draft' },
            pr.mergeStateStatus === 'dirty' && {
              text: 'Conflicts',
              tone: 'warning',
              title: 'This PR has merge conflicts',
            },
            { text: pr.author },
            { text: shortAge(pr.openedAt) },
            pr.approvalCount > 0 && {
              text: `${pr.approvalCount} approved`,
              title: `Approved by: ${pr.approvedBy.join(', ')}`,
            },
            pr.riskLevel === 'high' && { text: 'High risk', tone: 'danger' },
            pr.ciStatus === 'failing' && { text: 'CI failing', tone: 'danger' },
            mine && { text: 'Your review requested' },
            pr.sessionStatus !== 'not-started' && {
              text: `${pr.viewedFileCount} of ${pr.fileCount} viewed`,
            },
          ]}
        />
      </span>
      <span className="rd-side">
        <DiffSize additions={pr.additions} deletions={pr.deletions} fileCount={pr.fileCount} />
        <span className="rd-num">~{pr.estimatedMinutes} min</span>
      </span>
      <span className="rd-actions">
        <button
          type="button"
          className={isSession ? 'rd-btn rd-pri rd-always' : 'rd-btn'}
          onClick={(e) => {
            e.stopPropagation()
            open()
          }}
        >
          {actionLabel}
        </button>
        {onDismiss && pr.sessionStatus !== 'not-started' && (
          <button
            type="button"
            className="rd-btn rd-dismiss"
            onClick={(e) => {
              e.stopPropagation()
              void onDismiss(pr.number)
            }}
            title="Dismiss from in-progress"
            aria-label={`Dismiss PR #${pr.number} from in-progress`}
          >
            <X aria-hidden="true" />
          </button>
        )}
      </span>
    </div>
  )
}
