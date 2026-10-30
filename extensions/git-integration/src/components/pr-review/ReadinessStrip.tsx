import React, { useState } from 'react'
import {
  ArrowDown,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleX,
  Eye,
  GitMerge,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Button, Popover } from '@terminator/extension-ui'
import type { PrReviewDetail } from '../../schemas/pr-review.schema'
import { choose } from '../text'
import {
  GroupedCheckList,
  countChecks,
  detailedLabel,
  summaryStatus,
  type CheckState,
} from './StatusChecksBar'
import './readiness-strip.css'

export interface ReadinessBranch {
  updating: boolean
  resolving: boolean
  error: string | null
  onUpdate: () => void
  onResolve: () => void
}

export interface ReadinessStripProps {
  pr: PrReviewDetail
  youAreRequested: boolean
  branch: ReadinessBranch
}

type Tone = 'ok' | 'wait' | 'quiet' | 'bad'

interface CellProps {
  tone: Tone
  icon: LucideIcon
  label: string
  detail: string
  children?: React.ReactNode
}

function CellBody({ tone, icon: Icon, label, detail }: Omit<CellProps, 'children'>) {
  return (
    <>
      <Icon aria-hidden className="rs-icon" data-tone={tone} />
      <span className="rs-label">{label}</span>
      <span className="rs-detail">{detail}</span>
    </>
  )
}

function Cell(props: CellProps) {
  return (
    <div className={`rs-cell rs-cell--${props.tone}`}>
      <CellBody {...props} />
      {props.children && <span className="rs-end">{props.children}</span>}
    </div>
  )
}

const CHECK_TONE: Record<CheckState, { tone: Tone; icon: LucideIcon }> = {
  fail: { tone: 'bad', icon: CircleX },
  pending: { tone: 'wait', icon: CircleDashed },
  pass: { tone: 'ok', icon: CircleCheck },
  skipped: { tone: 'quiet', icon: CircleDashed },
  unknown: { tone: 'quiet', icon: CircleDashed },
}

function ChecksCell({ pr }: { pr: PrReviewDetail }) {
  const [open, setOpen] = useState(false)
  const checks = pr.statusChecks ?? []
  if (checks.length === 0) {
    return <Cell tone="quiet" icon={CircleDashed} label="Checks" detail="No checks" />
  }
  const counts = countChecks(checks)
  const { tone, icon } = CHECK_TONE[summaryStatus(counts)]
  const detail = detailedLabel(counts)
  return (
    <div className={`rs-cell rs-cell--${tone} rs-cell--anchor`}>
      <button
        type="button"
        className="rs-cell-button"
        aria-expanded={open}
        aria-label={`Checks ${detail}`}
        onClick={() => setOpen((v) => !v)}
      >
        <CellBody tone={tone} icon={icon} label="Checks" detail={detail} />
        <ChevronDown aria-hidden className="rs-chevron" />
      </button>
      {open && (
        <Popover label="Status checks" className="rs-pop" onDismiss={() => setOpen(false)}>
          <GroupedCheckList checks={checks} />
        </Popover>
      )}
    </div>
  )
}

function reviewsSummary(pr: PrReviewDetail): { tone: Tone; detail: string } {
  const approvers = (pr.approvals ?? []).map((a) => a.author).join(', ')
  const requested = (pr.requestedReviewers ?? []).join(', ')
  if (approvers) {
    const waiting = choose(requested !== '', ` · waiting on ${requested}`, '')
    return { tone: 'ok', detail: `Approved by ${approvers}${waiting}` }
  }
  if (requested) return { tone: 'wait', detail: `Waiting on ${requested}` }
  return { tone: 'quiet', detail: 'None requested' }
}

function ReviewsCell({ pr, youAreRequested }: { pr: PrReviewDetail; youAreRequested: boolean }) {
  const { tone, detail } = reviewsSummary(pr)
  return (
    <Cell tone={tone} icon={Users} label="Reviews" detail={detail}>
      {youAreRequested && (
        <span className="rs-chip" title="You have been requested to review this PR">
          <Eye aria-hidden />
          Your review requested
        </span>
      )}
    </Cell>
  )
}

function MergeCell({ pr, branch }: { pr: PrReviewDetail; branch: ReadinessBranch }) {
  const base = pr.baseRefName
  switch (pr.mergeStateStatus) {
    case 'clean':
      return <Cell tone="ok" icon={GitMerge} label="Merge" detail={`No conflicts with ${base}`} />
    case 'behind':
      return (
        <Cell tone="wait" icon={ArrowDown} label="Merge" detail={`Behind ${base}`}>
          <Button size="sm" onClick={branch.onUpdate} disabled={branch.updating}>
            {choose(branch.updating, 'Updating…', `Update from ${base}`)}
          </Button>
        </Cell>
      )
    case 'dirty':
      return (
        <Cell tone="bad" icon={TriangleAlert} label="Merge" detail={`Conflicts with ${base}`}>
          <Button size="sm" variant="danger" onClick={branch.onResolve} disabled={branch.resolving}>
            {choose(branch.resolving, 'Preparing merge…', 'Resolve conflicts')}
          </Button>
        </Cell>
      )
    default:
      return <Cell tone="quiet" icon={GitMerge} label="Merge" detail="Not reported" />
  }
}

/** Checks, reviews and merge state in one row; the answer to "can this ship?". */
export function ReadinessStrip({ pr, youAreRequested, branch }: ReadinessStripProps) {
  return (
    <>
      <div className="rs-strip" role="group" aria-label="Status">
        <ChecksCell pr={pr} />
        <ReviewsCell pr={pr} youAreRequested={youAreRequested} />
        <MergeCell pr={pr} branch={branch} />
      </div>
      {branch.error && (
        <p className="rs-error" role="alert">
          {branch.error}
        </p>
      )}
    </>
  )
}
