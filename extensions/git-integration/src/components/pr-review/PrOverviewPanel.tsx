import React from 'react'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { StatusChecksBar } from './StatusChecksBar'
import { RichContent } from './RichContent'
import type { PrReviewDetail } from '../../schemas/pr-review.schema'

interface Props {
  pr: PrReviewDetail
  sessionStatus: 'not-started' | 'in-progress' | 'paused'
  onStartReview: () => void
  onClose: () => void
  onPopOut?: () => void
}

const CI_LABEL: Record<PrReviewDetail['ciStatus'], string> = {
  passing: 'Passing',
  failing: 'Failing',
  pending: 'Pending',
  none: 'No CI',
}

export function PrOverviewPanel({ pr, sessionStatus, onStartReview, onClose, onPopOut }: Props) {
  const { viewedFiles } = usePrReviewStore()

  const allFiles = pr.chapters.flatMap((c) => c.files)
  const totalFiles = allFiles.length
  const totalAdditions = allFiles.reduce((s, f) => s + f.additions, 0)
  const totalDeletions = allFiles.reduce((s, f) => s + f.deletions, 0)
  const totalMinutes = pr.chapters.reduce((s, c) => s + c.estimatedMinutes, 0)

  const highFiles = allFiles.filter((f) => f.riskScore.level === 'high')
  const medFiles = allFiles.filter((f) => f.riskScore.level === 'medium')
  const lowFiles = allFiles.filter((f) => f.riskScore.level === 'low')

  // Top files with a composite score, sorted descending
  const hotspots = [...allFiles]
    .filter((f) => f.riskScore.composite != null && f.riskScore.level !== 'low')
    .sort((a, b) => (b.riskScore.composite ?? 0) - (a.riskScore.composite ?? 0))
    .slice(0, 6)

  const viewedCount = viewedFiles.size
  const reviewPct = totalFiles > 0 ? Math.round((viewedCount / totalFiles) * 100) : 0
  const isResume = sessionStatus === 'in-progress' || sessionStatus === 'paused'

  const age = formatAge(pr.openedAt)
  const startLabel =
    sessionStatus === 'paused' ? 'Resume Review' : isResume ? 'Continue Review' : 'Start Review'

  return (
    <div className="pr-overview">
      <div className="pr-review-topbar">
        <span className="pr-review-topbar-title">
          <span className="pr-overview-pr-num">#{pr.number}</span> {pr.title}
        </span>
        <div className="pr-review-topbar-actions">
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
      </div>

      <StatusChecksBar checks={pr.statusChecks ?? []} />

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
      </div>

      {/* CTA */}
      <div className="pr-overview-cta">
        <button className="pr-overview-start-btn" onClick={onStartReview}>
          {startLabel}
        </button>
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

function formatShortPath(path: string): string {
  const parts = path.split('/')
  if (parts.length <= 2) return path
  return `…/${parts.slice(-2).join('/')}`
}
