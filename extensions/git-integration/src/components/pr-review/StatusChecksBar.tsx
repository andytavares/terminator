import React, { useState } from 'react'
import { Check, CircleDashed, CircleHelp, Minus, X, type LucideIcon } from 'lucide-react'
import type { StatusCheck } from '../../schemas/pr-review.schema'

interface Props {
  checks: StatusCheck[]
  defaultExpanded?: boolean
}

/**
 * One icon per check state (Principle XII).
 *
 * This was a map of unicode characters printed as text — ✓ ✗ ◐ − ? — which
 * inherit a font rather than a size, and which a screen reader reads as
 * punctuation. Each is a component now, sized in CSS, with the state's name
 * carried in `title` beside it so the shape is never the only signal.
 */
const STATE_ICON: Record<StatusCheck['state'], LucideIcon> = {
  pass: Check,
  fail: X,
  pending: CircleDashed,
  skipped: Minus,
  unknown: CircleHelp,
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
        <span
          className={`pr-checks-summary-icon pr-checks-icon--${summaryStatus}`}
          title={summaryStatus}
        >
          {React.createElement(STATE_ICON[summaryStatus], { 'aria-hidden': true })}
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
              <span className={`pr-checks-icon pr-checks-icon--${check.state}`} title={check.state}>
                {React.createElement(STATE_ICON[check.state], { 'aria-hidden': true })}
              </span>
              <span className="pr-checks-name" title={check.name}>
                {check.name}
              </span>
              {check.url && (
                <a
                  className="pr-checks-link"
                  href={check.url}
                  onClick={(e) => {
                    e.preventDefault()
                    window.electronAPI.shell.openExternal(check.url!).catch(() => {})
                  }}
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
