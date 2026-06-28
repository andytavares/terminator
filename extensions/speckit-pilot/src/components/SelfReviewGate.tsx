import React, { useEffect, useState } from 'react'
import { CheckCircle, XCircle, AlertCircle, ArrowLeft, GitMerge } from 'lucide-react'
import type { SelfReviewResult } from '../types/speckit.types.js'
import { getSpeckitAPI } from '../types/electron.js'

interface SelfReviewGateProps {
  featureDir: string
}

interface QualityRow {
  label: string
  passed: boolean
  detail: string
}

function parseRows(result: SelfReviewResult): QualityRow[] {
  return [
    {
      label: 'Format',
      passed: result.format.passed,
      detail: result.format.passed ? 'Clean' : 'Issues found',
    },
    {
      label: 'Lint',
      passed: result.lint.passed,
      detail: result.lint.passed
        ? `${result.lint.warningCount} warnings`
        : `${result.lint.errorCount} errors, ${result.lint.warningCount} warnings`,
    },
    {
      label: 'Coverage',
      passed: result.coverage.passed,
      detail: `${result.coverage.percentage}%`,
    },
    {
      label: 'Google Review',
      passed: result.googleReview.passed,
      detail: result.googleReview.passed
        ? 'No blockers'
        : `${result.googleReview.blockerCount} blockers`,
    },
  ]
}

export function SelfReviewGate({ featureDir }: SelfReviewGateProps) {
  const [result, setResult] = useState<SelfReviewResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)

  useEffect(() => {
    const api = getSpeckitAPI()
    api
      .selfReviewRead({ featureDir })
      .then((res) => {
        if ('result' in res) setResult(res.result as SelfReviewResult)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [featureDir])

  async function handleBackToImplement() {
    setActing(true)
    const api = getSpeckitAPI()
    try {
      await api.phaseRequestChanges({
        featureDir,
        phase: 'implement',
        note: 'Self-review quality gate failed — see results.',
      })
    } finally {
      setActing(false)
    }
  }

  async function handleApprove() {
    setActing(true)
    const api = getSpeckitAPI()
    try {
      await api.phaseApprove({ featureDir, phase: 'self-review' })
    } finally {
      setActing(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 16, color: 'var(--tm-text-secondary)' }}>
        Loading self-review results…
      </div>
    )
  }

  if (!result) {
    return (
      <div style={{ padding: 16, color: 'var(--tm-text-secondary)' }}>
        No self-review results available.
      </div>
    )
  }

  const rows = parseRows(result)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--tm-text-primary)' }}>
        Self-Review Quality Gate
      </div>

      {/* Quality rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map((row) => (
          <div
            key={row.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              background: 'var(--tm-bg-elevated)',
              borderRadius: 6,
            }}
          >
            {row.passed ? (
              <CheckCircle size={14} style={{ color: 'var(--tm-success, #22c55e)' }} />
            ) : (
              <XCircle size={14} style={{ color: 'var(--tm-danger)' }} />
            )}
            <span style={{ flex: 1, fontSize: 13, color: 'var(--tm-text-primary)' }}>
              {row.label}
            </span>
            <span
              style={{
                fontSize: 12,
                color: row.passed ? 'var(--tm-text-secondary)' : 'var(--tm-danger)',
              }}
            >
              {row.detail}
            </span>
            {/* Coverage progress bar */}
            {row.label === 'Coverage' && (
              <div
                style={{
                  width: 60,
                  height: 6,
                  background: 'var(--tm-surface, #111827)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(result.coverage.percentage, 100)}%`,
                    height: '100%',
                    background: result.coverage.passed
                      ? 'var(--tm-success, #22c55e)'
                      : 'var(--tm-danger)',
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Warning for non-passing items */}
      {rows.some((r) => !r.passed) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            color: 'var(--tm-warning, #f59e0b)',
            fontSize: 12,
          }}
        >
          <AlertCircle size={12} />
          Some quality checks did not pass. Review before approving.
        </div>
      )}

      {/* Summary */}
      {result.summary && (
        <div style={{ fontSize: 12, color: 'var(--tm-text-secondary)', padding: '4px 0' }}>
          {result.summary}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          onClick={handleBackToImplement}
          disabled={acting}
          aria-label="Back to Implement"
          style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <ArrowLeft size={14} />
          Back to Implement
        </button>
        <button
          onClick={handleApprove}
          disabled={acting}
          aria-label="Approve → Open PR"
          style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <GitMerge size={14} />
          Approve → Open PR
        </button>
      </div>
    </div>
  )
}
