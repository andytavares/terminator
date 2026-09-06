import React, { useState, useEffect, useRef } from 'react'
import { Check, RefreshCw, TriangleAlert, X } from 'lucide-react'
import { usePrReviewStore } from '../../stores/pr-review.store'
import type { ReviewQueuePR } from '../../schemas/pr-review.schema'

type Filter = 'all' | 'stale'

const STALE_DAYS = 3

interface Props {
  repoRoot: string
  onOpenPr: (pr: ReviewQueuePR) => void
  onRefresh: (options?: { search?: string; includeClosedPrs?: boolean }) => Promise<void>
  onDismissPr: (prNumber: number) => Promise<void>
  includeClosedPrs: boolean
  onToggleClosedPrs: (include: boolean) => Promise<void>
}

export function ReviewQueue({
  repoRoot: _repoRoot,
  onOpenPr,
  onRefresh,
  onDismissPr,
  includeClosedPrs,
  onToggleClosedPrs,
}: Props) {
  const {
    prQueue,
    queueLoading,
    loadingMorePrs,
    queueError,
    rateLimitState,
    totalPrCount,
    currentUserLogin,
  } = usePrReviewStore()
  const [activeFilter, setActiveFilter] = useState<Filter>('all')
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

  const now = Date.now()
  const staleMs = STALE_DAYS * 24 * 60 * 60 * 1000

  function matchesFilter(pr: (typeof prQueue)[number]): boolean {
    switch (activeFilter) {
      case 'stale':
        return now - new Date(pr.openedAt).getTime() > staleMs
      default:
        return true
    }
  }

  // In-progress PRs always appear at the top regardless of active filter.
  const inProgress = prQueue.filter(
    (p) => p.sessionStatus === 'in-progress' || p.sessionStatus === 'paused'
  )
  const inProgressNumbers = new Set(inProgress.map((p) => p.number))

  // PRs where current user is a requested reviewer or assignee — filtered by active filter
  // so pills actually affect this section too.
  const needsMyReview = currentUserLogin
    ? prQueue.filter(
        (p) =>
          !inProgressNumbers.has(p.number) &&
          (p.requestedReviewers?.includes(currentUserLogin) ||
            p.assigneeLogins?.includes(currentUserLogin)) &&
          matchesFilter(p)
      )
    : []
  const needsMyReviewNumbers = new Set(needsMyReview.map((p) => p.number))

  const filtered = prQueue.filter((pr) => {
    if (inProgressNumbers.has(pr.number)) return false
    if (needsMyReviewNumbers.has(pr.number)) return false
    // Exclude needsMyReview PRs that were hidden by the filter (they shouldn't fall through).
    if (
      currentUserLogin &&
      (pr.requestedReviewers?.includes(currentUserLogin) ||
        pr.assigneeLogins?.includes(currentUserLogin)) &&
      !inProgressNumbers.has(pr.number)
    )
      return false
    return matchesFilter(pr)
  })

  const readFirst = filtered.filter((p) => p.riskLevel === 'high')
  const quickWins = filtered.filter(
    (p) => p.riskLevel === 'low' && p.additions + p.deletions <= 100
  )
  const larger = filtered.filter((p) => !readFirst.includes(p) && !quickWins.includes(p))

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
            {refreshing ? '↻' : '↺'} Retry
          </button>
        </div>
      )}

      {/* One line of triage, not four tiles.
          Two of the four routinely read "0" — half the row spent saying nothing
          is wrong — and two of the labels carried instructions inside them
          ("High risk — read these first"). A label names a metric; telling you
          what to do with it belongs in the grouping below, which already does. */}
      <div className="pr-summary-row">
        <p className="pr-summary">
          <b className="pr-summary__count">{totalPrCount ?? prQueue.length}</b> waiting on you
          {highRiskCount > 0 && (
            <>
              {' · '}
              <span className="pr-summary__risk">{highRiskCount} high risk</span>
            </>
          )}
          {inProgressCount > 0 && (
            <>
              {' · '}
              {inProgressCount} already started
            </>
          )}
          {minutesArePartial ? ' · at least ' : ' · about '}
          <b>{totalMinutes} min</b> of reading
        </p>
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

      {/* Search bar + state toggle */}
      <div className="pr-search-row">
        <input
          className="pr-search-input"
          type="search"
          placeholder="Search by title or PR number…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search pull requests"
        />
        <button
          className={`pr-state-toggle${includeClosedPrs ? ' pr-state-toggle--active' : ''}`}
          onClick={() => onToggleClosedPrs(!includeClosedPrs)}
          title={
            includeClosedPrs
              ? 'Showing open + closed — click for open only'
              : 'Showing open only — click to include closed'
          }
          aria-pressed={includeClosedPrs}
        >
          {includeClosedPrs ? 'Open + Closed' : 'Open only'}
        </button>
        {/* Three of the five pills — High risk, Quick wins, In progress — named
            a section that is already a heading in the list below, so pressing
            one hid four fifths of the page to reach something visible by
            scrolling. Age is the one axis the sections cannot express, so it is
            the one control that survives, and it sits with the other two
            controls that scope the list rather than owning a row of its own. */}
        {!searchQuery && (
          <button
            type="button"
            className={`pr-filter-pill${activeFilter === 'stale' ? ' pr-filter-pill--active' : ''}`}
            aria-pressed={activeFilter === 'stale'}
            onClick={() => setActiveFilter(activeFilter === 'stale' ? 'all' : 'stale')}
          >
            Open more than {STALE_DAYS} days
          </button>
        )}
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
          <>
            <PrSection
              title="In progress"
              prs={inProgress}
              accent="blue"
              onOpen={onOpenPr}
              onDismiss={onDismissPr}
            />
            <PrSection
              title="Needs your review"
              prs={needsMyReview}
              accent="yellow"
              onOpen={onOpenPr}
            />
            <PrSection title="Read these first" prs={readFirst} accent="red" onOpen={onOpenPr} />
            <PrSection title="Quick wins" prs={quickWins} accent="green" onOpen={onOpenPr} />
            <PrSection title="Larger reviews" prs={larger} accent="none" onOpen={onOpenPr} />
          </>
        )}
      </div>

      {/* Pages arrive on their own; this only says so while one is in flight. */}
      {loadingMorePrs && !searchQuery && <p className="pr-loading-rest">Loading the rest…</p>}
    </div>
  )
}

function PrSection({
  title,
  prs,
  accent,
  onOpen,
  onDismiss,
}: {
  title: string
  prs: ReviewQueuePR[]
  accent: 'red' | 'green' | 'blue' | 'yellow' | 'none'
  onOpen: (pr: ReviewQueuePR) => void
  onDismiss?: (prNumber: number) => Promise<void>
}) {
  if (prs.length === 0) return null
  return (
    <div className={`pr-section pr-section--${accent}`}>
      <h3 className="pr-section-title">{title}</h3>
      {prs.map((pr) => (
        <PrRow key={pr.number} pr={pr} onOpen={onOpen} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

const RISK_LABEL: Record<string, string> = {
  high: 'High risk',
  medium: 'Medium risk',
  low: 'Low risk',
}

function PrRow({
  pr,
  onOpen,
  onDismiss,
}: {
  pr: ReviewQueuePR
  onOpen: (pr: ReviewQueuePR) => void
  onDismiss?: (prNumber: number) => Promise<void>
}) {
  const isSession = pr.sessionStatus === 'paused' || pr.sessionStatus === 'in-progress'
  // The row is one button and its onClick is onOpen — so this label named an
  // outcome the click does not produce. On a low-risk PR it read "Approve" and
  // opened the diff. A control says what happens when it is used.
  const actionLabel =
    pr.sessionStatus === 'paused'
      ? 'Resume'
      : pr.sessionStatus === 'in-progress'
        ? 'Continue'
        : 'Review'
  const actionModifier = isSession ? 'session' : pr.riskLevel

  const age = formatAge(pr.openedAt)

  const fileProgress =
    pr.sessionStatus !== 'not-started' && pr.fileCount > 0
      ? Math.round((pr.viewedFileCount / pr.fileCount) * 100)
      : null

  return (
    <div className="pr-row-wrap">
      <button className={`pr-row pr-row--${pr.riskLevel}`} onClick={() => onOpen(pr)}>
        <div className="pr-row-left">
          <div className="pr-row-header">
            <span className="pr-row-number">#{pr.number}</span>
            {pr.isDraft && <span className="pr-row-draft">Draft</span>}
            {pr.mergeStateStatus === 'dirty' && (
              <span className="pr-row-conflicts" title="This PR has merge conflicts">
                <TriangleAlert aria-hidden="true" /> Conflicts
              </span>
            )}
          </div>
          <span className="pr-row-title">{pr.title}</span>
          <span className="pr-row-meta">
            {pr.author} · {age} · {pr.fileCount} files · +{pr.additions}/−{pr.deletions}
          </span>
          {pr.approvalCount > 0 && (
            <span className="pr-row-approved" title={`Approved by: ${pr.approvedBy.join(', ')}`}>
              <Check aria-hidden="true" /> {pr.approvalCount} approved
            </span>
          )}
          {fileProgress !== null && (
            <div className="pr-row-progress" aria-label={`${fileProgress}% of files reviewed`}>
              <div className="pr-row-progress-bar" style={{ width: `${fileProgress}%` }} />
            </div>
          )}
        </div>

        <div className="pr-row-right">
          {/* "MED" needs a key; "Medium risk" does not. The estimate carries a
              unit rather than floating as a bare "4m". */}
          <span className={`pr-risk-chip pr-risk-chip--${pr.riskLevel}`}>
            {RISK_LABEL[pr.riskLevel] ?? 'Unrated'}
          </span>
          <span className="pr-row-time">~{pr.estimatedMinutes} min</span>
          <span className={`pr-row-action pr-row-action--${actionModifier}`}>{actionLabel}</span>
        </div>
      </button>
      {onDismiss && pr.sessionStatus !== 'not-started' && (
        <button
          className="pr-row-dismiss-btn"
          onClick={() => void onDismiss(pr.number)}
          title="Dismiss from in-progress"
          aria-label={`Dismiss PR #${pr.number} from in-progress`}
        >
          <X aria-hidden="true" />
        </button>
      )}
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
