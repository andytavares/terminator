import React, { useState } from 'react'
import type { StatusCheck } from '../../schemas/pr-review.schema'

interface Props {
  checks: StatusCheck[]
  defaultExpanded?: boolean
}

const STATE_ICON: Record<StatusCheck['state'], string> = {
  pass: '✓',
  fail: '✗',
  pending: '◐',
  skipped: '−',
  unknown: '?',
}

export function StatusChecksBar({ checks, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  if (checks.length === 0) return null

  const failCount = checks.filter((c) => c.state === 'fail').length
  const pendingCount = checks.filter((c) => c.state === 'pending').length
  const passCount = checks.filter((c) => c.state === 'pass').length

  const summaryStatus: StatusCheck['state'] =
    failCount > 0 ? 'fail' : pendingCount > 0 ? 'pending' : passCount > 0 ? 'pass' : 'unknown'

  const summaryLabel =
    failCount > 0
      ? `${failCount} failing`
      : pendingCount > 0
        ? `${pendingCount} pending`
        : `${passCount} passing`

  return (
    <div className="pr-checks-bar">
      <button
        className={`pr-checks-summary pr-checks-summary--${summaryStatus}`}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title={expanded ? 'Hide status checks' : 'Show status checks'}
      >
        <span className={`pr-checks-summary-icon pr-checks-icon--${summaryStatus}`}>
          {STATE_ICON[summaryStatus]}
        </span>
        <span className="pr-checks-summary-label">
          {summaryLabel} · {checks.length} check{checks.length !== 1 ? 's' : ''}
        </span>
        <span className="pr-checks-chevron">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <ul className="pr-checks-list" role="list">
          {checks.map((check, i) => (
            <li key={i} className="pr-checks-item">
              <span className={`pr-checks-icon pr-checks-icon--${check.state}`}>
                {STATE_ICON[check.state]}
              </span>
              <span className="pr-checks-name" title={check.name}>
                {check.name}
              </span>
              {check.url && (
                <a
                  className="pr-checks-link"
                  href={check.url}
                  target="_blank"
                  rel="noreferrer"
                  title="Open check details"
                >
                  ↗
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
