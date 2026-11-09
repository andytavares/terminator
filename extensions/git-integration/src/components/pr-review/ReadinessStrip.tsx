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
import type { StackPlan } from '../../api/github'
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
  /** The pull requests this one is stacked on, when it is stacked. */
  stack?: StackPlan | null
  /** How the stack merge or the revert ended, in words. */
  notice?: string | null
}

type Tone = 'ok' | 'wait' | 'quiet' | 'bad'

interface CellProps {
  tone: Tone
  /** The reviewer must act. Defaults to a bad or waiting tone; Reviews waits on others, not me. */
  attention?: boolean
  icon: LucideIcon
  label: string
  detail: string
  children?: React.ReactNode
}

function CellBody({ tone, icon: Icon, label, detail }: Omit<CellProps, 'children' | 'attention'>) {
  return (
    <>
      <Icon aria-hidden className="rs-icon" data-tone={tone} data-testid="readiness-icon" />
      <span className="rs-label">{label}</span>
      <span className="rs-detail">{detail}</span>
    </>
  )
}

function Cell(props: CellProps) {
  return (
    <div
      className={`rs-cell rs-cell--${props.tone}`}
      data-attention={props.attention ?? needsAttention(props.tone)}
    >
      <CellBody {...props} />
      {props.children && <span className="rs-end">{props.children}</span>}
    </div>
  )
}

function needsAttention(tone: Tone): boolean {
  return tone === 'bad' || tone === 'wait'
}

const CHECK_TONE: Record<CheckState, { tone: Tone; icon: LucideIcon }> = {
  fail: { tone: 'bad', icon: CircleX },
  pending: { tone: 'wait', icon: CircleDashed },
  pass: { tone: 'ok', icon: CircleCheck },
  skipped: { tone: 'quiet', icon: CircleDashed },
  unknown: { tone: 'quiet', icon: CircleDashed },
}

function ChecksCell({ pr }: { pr: PrReviewDetail }) {
  const checks = pr.statusChecks ?? []
  if (checks.length === 0) {
    return <Cell tone="quiet" icon={CircleDashed} label="Checks" detail="No checks" />
  }
  return <ReportedChecksCell checks={checks} />
}

/** The checks summary, which opens the checks grouped failures-first. */
function ReportedChecksCell({ checks }: { checks: NonNullable<PrReviewDetail['statusChecks']> }) {
  const [open, setOpen] = useState(false)
  const counts = countChecks(checks)
  const { tone, icon } = CHECK_TONE[summaryStatus(counts)]
  const detail = detailedLabel(counts)
  return (
    <div
      className={`rs-cell rs-cell--${tone} rs-cell--anchor`}
      data-attention={needsAttention(tone)}
    >
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
    <Cell tone={tone} attention={youAreRequested} icon={Users} label="Reviews" detail={detail}>
      {youAreRequested && (
        <span className="rs-chip" title="You have been requested to review this PR">
          <Eye aria-hidden />
          Your review requested
        </span>
      )}
    </Cell>
  )
}

/** "No conflicts with feat/retry", led by "Stacked on #1 · " when #1 is the pull request below. */
function cleanDetail(base: string, stack?: StackPlan | null): string {
  const below = stack?.stack.at(-2)
  const clean = `No conflicts with ${base}`
  return below ? `Stacked on #${below.number} · ${clean}` : clean
}

function MergeCell({ pr, branch, stack }: Pick<ReadinessStripProps, 'pr' | 'branch' | 'stack'>) {
  const base = pr.baseRefName
  if (pr.state === 'merged') {
    return <Cell tone="ok" icon={GitMerge} label="Merge" detail={`Merged into ${base}`} />
  }
  switch (pr.mergeStateStatus) {
    case 'clean':
      return <Cell tone="ok" icon={GitMerge} label="Merge" detail={cleanDetail(base, stack)} />
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
export function ReadinessStrip({
  pr,
  youAreRequested,
  branch,
  stack,
  notice,
}: ReadinessStripProps) {
  return (
    <>
      <div className="rs-strip" role="group" aria-label="Status">
        <ChecksCell pr={pr} />
        <ReviewsCell pr={pr} youAreRequested={youAreRequested} />
        <MergeCell pr={pr} branch={branch} stack={stack} />
      </div>
      {branch.error && (
        <p className="rs-error" role="alert">
          {branch.error}
        </p>
      )}
      {notice && (
        <p className="rs-error" role="status">
          {notice}
        </p>
      )}
    </>
  )
}
