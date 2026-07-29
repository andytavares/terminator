import React, { useEffect, useState } from 'react'
import { CheckCircle, XCircle, MinusCircle, AlertCircle, ArrowLeft, GitMerge } from 'lucide-react'
import type { SelfReviewResult } from '../types/speckit.types.js'
import { getSpeckitAPI } from '../types/electron.js'

interface SelfReviewGateProps {
  featureDir: string
}

interface QualityRow {
  label: string
  /** Null when the check did not run: not a pass, and not its failure either. */
  passed: boolean | null
  detail: string
}

/** A count the tool did not report reads as unknown, never as zero. */
function count(value: number | null, unit: string): string {
  return value === null ? `${unit} not reported` : `${value} ${unit}`
}

function parseRows(result: SelfReviewResult): QualityRow[] {
  return [
    {
      label: 'Format',
      passed: result.format.passed,
      detail:
        result.format.passed === null
          ? 'Not checked'
          : result.format.passed
            ? 'Clean'
            : 'Issues found',
    },
    {
      label: 'Lint',
      passed: result.lint.passed,
      detail:
        result.lint.passed === null
          ? 'Not run'
          : result.lint.passed
            ? count(result.lint.warningCount, 'warnings')
            : `${count(result.lint.errorCount, 'errors')}, ${count(result.lint.warningCount, 'warnings')}`,
    },
    {
      label: 'Coverage',
      passed: result.coverage.passed,
      detail:
        result.coverage.percentage === null
          ? result.coverage.passed === null
            ? 'Not run'
            : 'Not reported'
          : `${result.coverage.percentage}%`,
    },
    {
      label: 'Google Review',
      passed: result.googleReview.passed,
      detail:
        result.googleReview.passed === null
          ? 'Not run'
          : // The review writes prose, not a count. Saying "0 blockers" from a
            // passing exit code would be a number nobody measured.
            result.googleReview.passed
            ? 'No blockers reported'
            : 'Blockers reported — read the review above',
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

  // Deliberately not an early return. The checks run as a shell chain whose
  // output goes to the console, and nothing writes the parsed summary yet — so
  // returning here left the phase with no approve button anywhere, and the card
  // could not move. A gate that cannot be answered is worse than one with no
  // summary on it.
  const rows = result === null ? [] : parseRows(result)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--tm-text-primary)' }}>
        Self-Review Quality Gate
      </div>

      {rows.length === 0 && (
        <div style={{ color: 'var(--tm-text-secondary)', fontSize: 12 }}>
          No parsed summary — the checks ran as a shell chain and their output is in the console
          above. Read it before deciding.
        </div>
      )}

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
            {/* A check that did not run gets neither mark: a tick would claim
                it passed, a cross would blame it for failing. */}
            {row.passed === null ? (
              <MinusCircle size={14} style={{ color: 'var(--tm-text-secondary)' }} />
            ) : row.passed ? (
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
                color: row.passed === false ? 'var(--tm-danger)' : 'var(--tm-text-secondary)',
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
                    width: `${Math.min(result?.coverage.percentage ?? 0, 100)}%`,
                    height: '100%',
                    background: result?.coverage.passed
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
      {rows.some((r) => r.passed === false) && (
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
      {result?.summary && (
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
