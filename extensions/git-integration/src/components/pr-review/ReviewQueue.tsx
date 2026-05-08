import React, { useState } from 'react'
import { usePrReviewStore } from '../../stores/pr-review.store'
import type { ReviewQueuePR } from '../../schemas/pr-review.schema'

type Filter = 'all' | 'high-risk' | 'quick-wins' | 'in-progress' | 'stale'

const STALE_DAYS = 3

interface Props {
  repoRoot: string
  onOpenPr: (pr: ReviewQueuePR) => void
}

export function ReviewQueue({ repoRoot: _repoRoot, onOpenPr }: Props) {
  const { prQueue, queueLoading, queueError, rateLimitState } = usePrReviewStore()
  const [activeFilter, setActiveFilter] = useState<Filter>('all')

  const now = Date.now()
  const staleMs = STALE_DAYS * 24 * 60 * 60 * 1000

  const filtered = prQueue.filter(pr => {
    switch (activeFilter) {
      case 'high-risk':    return pr.riskLevel === 'high'
      case 'quick-wins':   return pr.riskLevel === 'low' && (pr.additions + pr.deletions) <= 100
      case 'in-progress':  return pr.sessionStatus === 'in-progress' || pr.sessionStatus === 'paused'
      case 'stale':        return (now - new Date(pr.openedAt).getTime()) > staleMs
      default:             return true
    }
  })

  const readFirst   = filtered.filter(p => p.riskLevel === 'high')
  const quickWins   = filtered.filter(p => p.riskLevel === 'low' && (p.additions + p.deletions) <= 100)
  const inProgress  = filtered.filter(p => p.sessionStatus === 'in-progress' || p.sessionStatus === 'paused')
  const larger      = filtered.filter(p => !readFirst.includes(p) && !quickWins.includes(p) && !inProgress.includes(p))

  const totalMinutes = prQueue.reduce((s, p) => s + p.estimatedMinutes, 0)
  const highRiskCount = prQueue.filter(p => p.riskLevel === 'high').length
  const inProgressCount = prQueue.filter(p => p.sessionStatus !== 'not-started').length

  const filters: { id: Filter; label: string }[] = [
    { id: 'all',          label: 'All' },
    { id: 'high-risk',    label: 'High risk' },
    { id: 'quick-wins',   label: 'Quick wins' },
    { id: 'in-progress',  label: 'In progress' },
    { id: 'stale',        label: 'Stale >3d' },
  ]

  if (queueLoading) {
    return <div className="pr-queue-loading">Loading pull requests…</div>
  }

  if (queueError) {
    return <div className="pr-queue-error">Failed to load queue: {queueError}</div>
  }

  return (
    <div className="pr-review-queue">
      {rateLimitState && (
        <div className="pr-rate-limit-banner">
          GitHub API rate limit reached. Some data may be incomplete. Resets soon.
        </div>
      )}

      {/* Stat cards */}
      <div className="pr-stat-cards">
        <div className="pr-stat-card">
          <span className="pr-stat-value">{prQueue.length}</span>
          <span className="pr-stat-label">Awaiting review</span>
        </div>
        <div className="pr-stat-card pr-stat-card--high">
          <span className="pr-stat-value">{highRiskCount}</span>
          <span className="pr-stat-label">High risk — read these first</span>
        </div>
        <div className="pr-stat-card">
          <span className="pr-stat-value">{totalMinutes}m</span>
          <span className="pr-stat-label">Total review time</span>
        </div>
        <div className="pr-stat-card">
          <span className="pr-stat-value">{inProgressCount}</span>
          <span className="pr-stat-label">In progress — resume from where you stopped</span>
        </div>
      </div>

      {/* Filter pills */}
      <div className="pr-filter-pills">
        {filters.map(f => (
          <button
            key={f.id}
            className={`pr-filter-pill${activeFilter === f.id ? ' pr-filter-pill--active' : ''}`}
            onClick={() => setActiveFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Sections */}
      <div className="pr-sections">
        {prQueue.length === 0 ? (
          <div className="pr-queue-empty">No open pull requests.</div>
        ) : (
          <>
            <PrSection title="In progress"    prs={inProgress} accent="blue"  onOpen={onOpenPr} />
            <PrSection title="Read these first" prs={readFirst} accent="red"   onOpen={onOpenPr} />
            <PrSection title="Quick wins"     prs={quickWins}  accent="green" onOpen={onOpenPr} />
            <PrSection title="Larger reviews" prs={larger}     accent="none"  onOpen={onOpenPr} />
          </>
        )}
      </div>
    </div>
  )
}

function PrSection({ title, prs, accent, onOpen }: {
  title: string
  prs: ReviewQueuePR[]
  accent: 'red' | 'green' | 'blue' | 'none'
  onOpen: (pr: ReviewQueuePR) => void
}) {
  if (prs.length === 0) return null
  return (
    <div className={`pr-section pr-section--${accent}`}>
      <h3 className="pr-section-title">{title}</h3>
      {prs.map(pr => <PrRow key={pr.number} pr={pr} onOpen={onOpen} />)}
    </div>
  )
}

const SIGNAL_LABELS = ['Tests', 'Coverage', 'CI', 'Lint', 'Churn', 'Blast'] as const

function PrRow({ pr, onOpen }: { pr: ReviewQueuePR; onOpen: (pr: ReviewQueuePR) => void }) {
  const dots = [pr.signalDots.tests, pr.signalDots.coverage, pr.signalDots.ci,
                pr.signalDots.lint, pr.signalDots.churn, pr.signalDots.blast]

  const actionLabel =
    pr.sessionStatus === 'paused'      ? `Resume Ch ${pr.resumeChapter ?? 1}/${pr.resumeChapterTotal ?? '?'}` :
    pr.sessionStatus === 'in-progress' ? 'Continue' :
    pr.riskLevel === 'high'            ? 'Review' : 'Approve'

  const age = formatAge(pr.openedAt)

  return (
    <button className="pr-row" onClick={() => onOpen(pr)}>
      <div className="pr-row-left">
        <span className="pr-row-number">#{pr.number}</span>
        {pr.isDraft && <span className="pr-row-draft">Draft</span>}
        <span className="pr-row-title">{pr.title}</span>
        <span className="pr-row-meta">{pr.author} · {age} · {pr.fileCount} files · +{pr.additions}/−{pr.deletions}</span>
      </div>

      <div className="pr-row-signals">
        {dots.map((level, i) => (
          <span key={i} className={`pr-signal-dot pr-signal-dot--${level}`} title={SIGNAL_LABELS[i]} />
        ))}
      </div>

      <div className="pr-row-right">
        <span className="pr-row-time">{pr.estimatedMinutes}m</span>
        <span className={`pr-row-action pr-row-action--${pr.riskLevel}`}>{actionLabel}</span>
      </div>
    </button>
  )
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return '1d ago'
  return `${days}d ago`
}
