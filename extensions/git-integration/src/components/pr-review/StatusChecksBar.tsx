import React, { useState } from 'react'
import { Check, CircleDashed, CircleHelp, Minus, X, type LucideIcon } from 'lucide-react'
import type { StatusCheck } from '../../schemas/pr-review.schema'
import { choose, plural } from '../text'

interface Props {
  checks: StatusCheck[]
  defaultExpanded?: boolean
  /** Name the failing checks and count against the total: "2 of 8 checks failing · Format, lint". */
  detailed?: boolean
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

type CheckState = StatusCheck['state']

interface CheckCounts {
  total: number
  fail: number
  pending: number
  pass: number
  failingNames: string[]
}

function countChecks(checks: StatusCheck[]): CheckCounts {
  const failing = checks.filter((c) => c.state === 'fail')
  return {
    total: checks.length,
    fail: failing.length,
    pending: checks.filter((c) => c.state === 'pending').length,
    pass: checks.filter((c) => c.state === 'pass').length,
    failingNames: failing.map((c) => c.name),
  }
}

function summaryStatus(c: CheckCounts): CheckState {
  if (c.fail > 0) return 'fail'
  if (c.pending > 0) return 'pending'
  if (c.pass > 0) return 'pass'
  return 'unknown'
}

/** "2 failing · 8 checks". */
function shortLabel(c: CheckCounts): string {
  const noun = plural(c.total, 'check')
  if (c.fail > 0) return `${c.fail} failing · ${c.total} ${noun}`
  if (c.pending > 0) return `${c.pending} pending · ${c.total} ${noun}`
  return `${c.pass} passing · ${c.total} ${noun}`
}

/** "2 of 8 checks failing · Format, lint". */
function detailedLabel(c: CheckCounts): string {
  const noun = plural(c.total, 'check')
  if (c.fail > 0) return `${c.fail} of ${c.total} ${noun} failing · ${c.failingNames.join(', ')}`
  if (c.pending > 0) return `${c.pending} of ${c.total} ${noun} pending`
  if (c.pass > 0) return `${c.pass} ${plural(c.pass, 'check')} passing`
  return `${c.total} ${noun}`
}

function StateIcon({ state, className }: { state: CheckState; className: string }) {
  return (
    <span className={className} title={state}>
      {React.createElement(STATE_ICON[state], { 'aria-hidden': true })}
    </span>
  )
}

function CheckLink({ url }: { url: string }) {
  return (
    <a
      className="pr-checks-link"
      href={url}
      onClick={(e) => {
        e.preventDefault()
        window.electronAPI.shell.openExternal(url).catch(() => {})
      }}
      title="Open check details"
    >
      ↗
    </a>
  )
}

function CheckList({ checks }: { checks: StatusCheck[] }) {
  return (
    <ul className="pr-checks-list" role="list">
      {checks.map((check, i) => (
        <li key={i} className="pr-checks-item">
          <StateIcon
            state={check.state}
            className={`pr-checks-icon pr-checks-icon--${check.state}`}
          />
          <span className="pr-checks-name" title={check.name}>
            {check.name}
          </span>
          {check.url && <CheckLink url={check.url} />}
        </li>
      ))}
    </ul>
  )
}

export function StatusChecksBar(props: Props) {
  const { checks } = props
  const [expanded, setExpanded] = useState(props.defaultExpanded ?? false)
  if (checks.length === 0) return null
  const counts = countChecks(checks)
  const status = summaryStatus(counts)
  const label = choose(props.detailed, detailedLabel(counts), shortLabel(counts))
  return (
    <div className="pr-checks-bar">
      <button
        className={`pr-checks-summary pr-checks-summary--${status}`}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title={choose(expanded, 'Hide status checks', 'Show status checks')}
      >
        <StateIcon state={status} className={`pr-checks-summary-icon pr-checks-icon--${status}`} />
        <span className="pr-checks-summary-label">{label}</span>
        <span className="pr-checks-chevron">{choose(expanded, '▲', '▼')}</span>
      </button>
      {expanded && <CheckList checks={checks} />}
    </div>
  )
}
