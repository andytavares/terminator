import React, { useState, useEffect, useRef } from 'react'
import { usePrReviewStore } from '../../stores/pr-review.store'
import type { ReviewQueuePR } from '../../schemas/pr-review.schema'

type Filter = 'all' | 'high-risk' | 'quick-wins' | 'in-progress' | 'stale'

const STALE_DAYS = 3

interface Props {
  repoRoot: string
  onOpenPr: (pr: ReviewQueuePR) => void
  onRefresh: (options?: { search?: string; includeClosedPrs?: boolean }) => Promise<void>
  onLoadMore: () => Promise<void>
  onDismissPr: (prNumber: number) => Promise<void>
  includeClosedPrs: boolean
  onToggleClosedPrs: (include: boolean) => Promise<void>
}

export function ReviewQueue({
  repoRoot: _repoRoot,
  onOpenPr,
  onRefresh,
  onLoadMore,
  onDismissPr,
  includeClosedPrs,
  onToggleClosedPrs,
}: Props) {
  const { prQueue, queueLoading, loadingMorePrs, queueError, rateLimitState, hasMorePrs } =
    usePrReviewStore()
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

  const handleLoadMore = async () => {
    await onLoadMore()
  }

  const now = Date.now()
  const staleMs = STALE_DAYS * 24 * 60 * 60 * 1000

  // In-progress PRs always appear at the top regardless of active filter
  const inProgress = prQueue.filter(
    (p) => p.sessionStatus === 'in-progress' || p.sessionStatus === 'paused'
  )
  const inProgressNumbers = new Set(inProgress.map((p) => p.number))

  const filtered = prQueue.filter((pr) => {
    // Already shown in the in-progress section
    if (inProgressNumbers.has(pr.number)) return false
    switch (activeFilter) {
      case 'high-risk':
        return pr.riskLevel === 'high'
      case 'quick-wins':
        return pr.riskLevel === 'low' && pr.additions + pr.deletions <= 100
      case 'in-progress':
        return false // already captured above
      case 'stale':
        return now - new Date(pr.openedAt).getTime() > staleMs
      default:
        return true
    }
  })

  const readFirst = filtered.filter((p) => p.riskLevel === 'high')
  const quickWins = filtered.filter(
    (p) => p.riskLevel === 'low' && p.additions + p.deletions <= 100
  )
  const larger = filtered.filter((p) => !readFirst.includes(p) && !quickWins.includes(p))

  const totalMinutes = prQueue.reduce((s, p) => s + p.estimatedMinutes, 0)
  const highRiskCount = prQueue.filter((p) => p.riskLevel === 'high').length
  const inProgressCount = prQueue.filter((p) => p.sessionStatus !== 'not-started').length

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'high-risk', label: 'High risk' },
    { id: 'quick-wins', label: 'Quick wins' },
    { id: 'in-progress', label: 'In progress' },
    { id: 'stale', label: 'Stale >3d' },
  ]

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

      {/* Stat cards + refresh */}
      <div className="pr-stat-cards-row">
        <div className="pr-stat-cards">
          <div
            className="pr-stat-card"
            title="Total number of open pull requests awaiting your review."
          >
            <span className="pr-stat-value">
              {prQueue.length}
              {hasMorePrs ? '+' : ''}
            </span>
            <span className="pr-stat-label">Awaiting review</span>
          </div>
          <div
            className="pr-stat-card pr-stat-card--high"
            title="PRs with composite risk score ≥ 70 — flagged HIGH. These touch complex or heavily-imported files and need careful review."
          >
            <span className="pr-stat-value">{highRiskCount}</span>
            <span className="pr-stat-label">High risk — read these first</span>
          </div>
          <div
            className="pr-stat-card"
            title="Estimated total review time across all open PRs, based on file count and diff size."
          >
            <span className="pr-stat-value">{totalMinutes}m</span>
            <span className="pr-stat-label">Total review time</span>
          </div>
          <div
            className="pr-stat-card"
            title="PRs you have already opened — resume from where you stopped."
          >
            <span className="pr-stat-value">{inProgressCount}</span>
            <span className="pr-stat-label">In progress — resume from where you stopped</span>
          </div>
        </div>
        <button
          className={`pr-refresh-btn${refreshing ? ' pr-refresh-btn--spinning' : ''}`}
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh pull requests"
          aria-label="Refresh pull requests"
        >
          ↻
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
      </div>

      {/* Filter pills — only show when not searching */}
      {!searchQuery && (
        <div className="pr-filter-pills">
          {filters.map((f) => (
            <button
              key={f.id}
              className={`pr-filter-pill${activeFilter === f.id ? ' pr-filter-pill--active' : ''}`}
              onClick={() => setActiveFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

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
            {activeFilter === 'in-progress' && inProgress.length === 0 && (
              <div className="pr-queue-empty">
                No in-progress reviews yet. Open a PR to start reviewing.
              </div>
            )}
            {activeFilter !== 'in-progress' && (
              <>
                <PrSection
                  title="Read these first"
                  prs={readFirst}
                  accent="red"
                  onOpen={onOpenPr}
                />
                <PrSection title="Quick wins" prs={quickWins} accent="green" onOpen={onOpenPr} />
                <PrSection title="Larger reviews" prs={larger} accent="none" onOpen={onOpenPr} />
              </>
            )}
          </>
        )}
      </div>

      {/* Load more */}
      {hasMorePrs && !searchQuery && !queueLoading && (
        <div className="pr-load-more-row">
          <button className="pr-load-more-btn" onClick={handleLoadMore} disabled={loadingMorePrs}>
            {loadingMorePrs ? 'Loading…' : 'Load more pull requests'}
          </button>
        </div>
      )}
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
  accent: 'red' | 'green' | 'blue' | 'none'
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

const SIGNAL_LABELS = ['Tests', 'Coverage', 'CI', 'Lint', 'Churn', 'Blast'] as const

function PrRow({
  pr,
  onOpen,
  onDismiss,
}: {
  pr: ReviewQueuePR
  onOpen: (pr: ReviewQueuePR) => void
  onDismiss?: (prNumber: number) => Promise<void>
}) {
  const dots = [
    pr.signalDots.tests,
    pr.signalDots.coverage,
    pr.signalDots.ci,
    pr.signalDots.lint,
    pr.signalDots.churn,
    pr.signalDots.blast,
  ]

  const isSession = pr.sessionStatus === 'paused' || pr.sessionStatus === 'in-progress'
  const actionLabel =
    pr.sessionStatus === 'paused'
      ? 'Resume'
      : pr.sessionStatus === 'in-progress'
        ? 'Continue'
        : pr.riskLevel === 'high'
          ? 'Review'
          : 'Approve'
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
          <span className="pr-row-number">#{pr.number}</span>
          {pr.isDraft && <span className="pr-row-draft">Draft</span>}
          <span className="pr-row-title">{pr.title}</span>
          <span className="pr-row-meta">
            {pr.author} · {age} · {pr.fileCount} files · +{pr.additions}/−{pr.deletions}
          </span>
          {fileProgress !== null && (
            <div className="pr-row-progress" aria-label={`${fileProgress}% of files reviewed`}>
              <div className="pr-row-progress-bar" style={{ width: `${fileProgress}%` }} />
            </div>
          )}
        </div>

        <div className="pr-row-signals">
          {dots.map((level, i) => (
            <span
              key={i}
              className={`pr-signal-dot pr-signal-dot--${level}`}
              title={SIGNAL_LABELS[i]}
            />
          ))}
        </div>

        <div className="pr-row-right">
          <span className="pr-row-time">{pr.estimatedMinutes}m</span>
          <span className={`pr-risk-chip pr-risk-chip--${pr.riskLevel}`}>
            {pr.riskLevel === 'high' ? 'HIGH' : pr.riskLevel === 'medium' ? 'MED' : 'LOW'}
          </span>
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
          ×
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
