import React, { useEffect, useState } from 'react'
import { BookOpen, Copy, Flame, FlaskConical, GitBranch, HeartPulse } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { IconButton, RelativeTime } from '@terminator/extension-ui'
import type { PrReviewDetail } from '../../schemas/pr-review.schema'
import { insightsPending, overviewSignals, type Signal } from './overview-signals'
import { IssueRefList } from './IssueRefs'
import './properties-rail.css'

const SIGNAL_ICONS: Record<Signal['kind'], LucideIcon> = {
  risk: Flame,
  tests: FlaskConical,
  complexity: GitBranch,
  reading: BookOpen,
  health: HeartPulse,
}

const COPIED_MILLISECONDS = 1500

function SignalRow({ signal }: { signal: Signal }) {
  const Icon = SIGNAL_ICONS[signal.kind]
  return (
    <li className={`pr-rail-signal pr-rail-signal--${signal.tone}`} title={signal.source}>
      <Icon className="pr-rail-signal-icon" aria-hidden />
      <span className="pr-rail-signal-label">{signal.label}</span>
      <span className="pr-rail-signal-value">
        {signal.value}
        {signal.detail !== null && <small>{signal.detail}</small>}
      </span>
    </li>
  )
}

function SignalsSection({ pr }: { pr: PrReviewDetail }) {
  const [risk, ...rest] = overviewSignals(pr)
  return (
    <section>
      <h2 className="pr-rail-heading">Signals</h2>
      <ul className="pr-rail-signals">
        {risk && <SignalRow signal={risk} />}
        {insightsPending(pr) && <li className="pr-rail-pending">Analysing this PR…</li>}
        {rest.map((signal) => (
          <SignalRow key={signal.kind} signal={signal} />
        ))}
      </ul>
    </section>
  )
}

function CopyBranchButton({ branch }: { branch: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), COPIED_MILLISECONDS)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = () => {
    navigator.clipboard
      .writeText(branch)
      .then(() => setCopied(true))
      .catch(() => {})
  }
  return (
    <>
      <IconButton icon={Copy} label="Copy branch name" onClick={copy} />
      {copied && <small>Copied</small>}
    </>
  )
}

function openedOn(openedAt: string): string {
  return new Date(openedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function LinkedIssues({ pr }: { pr: PrReviewDetail }) {
  const issueRefs = pr.issueRefs ?? []
  if (issueRefs.length === 0) return <small>No linked issues</small>
  return <IssueRefList issueRefs={issueRefs} />
}

function BranchDetails({ pr }: { pr: PrReviewDetail }) {
  return (
    <>
      <dt>Branch</dt>
      <dd>
        <code>{pr.headRefName}</code>
        <CopyBranchButton branch={pr.headRefName} />
      </dd>
      <dt>Into</dt>
      <dd>
        <code>{pr.baseRefName}</code>
      </dd>
    </>
  )
}

function OpenedDetails({ pr }: { pr: PrReviewDetail }) {
  return (
    <>
      <dt>Opened</dt>
      <dd>
        {openedOn(pr.openedAt)}
        <small>
          <RelativeTime value={pr.openedAt} />
        </small>
      </dd>
    </>
  )
}

function DetailsSection({ pr }: { pr: PrReviewDetail }) {
  return (
    <section>
      <h2 className="pr-rail-heading">Details</h2>
      <dl className="pr-rail-details">
        <dt>Author</dt>
        <dd>{pr.author}</dd>
        <BranchDetails pr={pr} />
        <OpenedDetails pr={pr} />
        <dt>Head</dt>
        <dd>
          <code>{pr.headSHA.slice(0, 7)}</code>
        </dd>
        <dt>Linked issues</dt>
        <dd>
          <LinkedIssues pr={pr} />
        </dd>
      </dl>
    </section>
  )
}

export function PropertiesRail({ pr }: { pr: PrReviewDetail }) {
  return (
    <aside className="pr-rail" aria-label="Pull request details">
      <SignalsSection pr={pr} />
      <DetailsSection pr={pr} />
    </aside>
  )
}
