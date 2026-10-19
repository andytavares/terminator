import { HOME_MEASURES, SEND_TO_AGENT_ACTION } from '@terminator/extension-sdk'
import type { HomeAsk, HomeFeed, HomeMeasure, ThreadFacet } from '@terminator/extension-sdk'
import type { DashboardPR } from '../schemas/pr-review.schema.js'
import type { MergedPullRequest } from '../github/merged-search.js'
import type { ContributionCalendar } from '../review/contribution-calendar.js'
import { workKeyOf, type TicketIndex } from './work-key.js'
import type { DashboardCheck } from '../schemas/pr-review.schema.js'

// Pure builders from the data the Reviews dashboard and the contributions calendar already
// fetched to what Home draws (ADR 117). Nothing here reads GitHub.

const REVIEW_PULL_REQUEST = 'terminator.git-integration.command.review-pull-request'
const WEEKS_IN_QUARTER = 13
const RAIL_DAYS = 36

/** Stable id of a pull request across refreshes; actions look the pull request up by it. */
export function pullRequestId(pr: Pick<DashboardPR, 'repo' | 'number'>): string {
  return `${pr.repo}#${pr.number}`
}

/** What the review command takes: the checkout, else the repository the dashboard found it in. */
export function reviewTarget(pr: DashboardPR): { repoRoot: string; number: number } {
  return { repoRoot: pr.localRepoRoot ?? `gh:${pr.repo}`, number: pr.number }
}

/** "Fluent · TAV-20 · pull request #41": the repo's name, its ticket when it has one, the number. */
function pullRequestWhere(pr: DashboardPR, tickets: TicketIndex): string {
  const key = workKeyOf(pr, tickets)
  const ticket = key !== null && 'key' in key ? [key.key] : []
  return [pr.repo.split('/').at(-1) ?? pr.repo, ...ticket, `pull request #${pr.number}`].join(' · ')
}

function reviewRequestAsk(pr: DashboardPR, tickets: TicketIndex): HomeAsk {
  return {
    id: `review:${pullRequestId(pr)}`,
    kind: 'review',
    title: pr.reviewedByMe ? 'Re-review requested' : 'Review requested',
    detail: pr.title,
    where: pullRequestWhere(pr, tickets),
    facts: [
      `${pr.fileCount} files`,
      `+${pr.additions} −${pr.deletions}`,
      `about ${pr.estimatedMinutes} min`,
      `${pr.riskLevel} risk`,
    ],
    workKey: workKeyOf(pr, tickets),
    since: pr.reviewRequestedAt ?? pr.createdAt,
    actions: [{ id: 'start-review', label: 'Start review', primary: true }],
    open: { command: REVIEW_PULL_REQUEST, args: reviewTarget(pr) },
  }
}

const failedChecksOf = (pr: DashboardPR): DashboardCheck[] =>
  (pr.checks ?? []).filter((check) => check.state === 'failed')

/** "End-to-end tests: 2 of 14 failed", or the plain fact when the checks were not read. */
function failureDetail(pr: DashboardPR, failed: DashboardCheck[]): string {
  if (failed.length === 0) return 'Checks failed'
  return `${failed[0].name}: ${failed.length} of ${pr.checks?.length ?? failed.length} failed`
}

/** When the latest failing check finished, else when the pull request was opened. */
function failedSince(pr: DashboardPR, failed: DashboardCheck[]): string {
  const finished = failed.flatMap((check) => (check.completedAt ? [check.completedAt] : []))
  return finished.sort().at(-1) ?? pr.createdAt
}

function fixAsk(pr: DashboardPR, tickets: TicketIndex): HomeAsk {
  const failed = failedChecksOf(pr)
  return {
    id: `fix:${pullRequestId(pr)}`,
    kind: 'fix',
    title: 'Check failed',
    detail: failureDetail(pr, failed),
    where: pullRequestWhere(pr, tickets),
    facts: failed.map((check) => check.name),
    workKey: workKeyOf(pr, tickets),
    since: failedSince(pr, failed),
    actions: [
      { id: SEND_TO_AGENT_ACTION, label: 'Send to agent', primary: true },
      { id: 'open-log', label: 'Open log' },
    ],
    open: { command: REVIEW_PULL_REQUEST, args: reviewTarget(pr) },
  }
}

/** Reviews others wait on, and my own pull requests whose checks fail.
 * @internal */
export function buildAsks(prs: DashboardPR[], tickets: TicketIndex): HomeAsk[] {
  return prs.flatMap((pr) => {
    if (pr.section === 'requested') return [reviewRequestAsk(pr, tickets)]
    if (pr.section === 'mine' && pr.ciStatus === 'failing') return [fixAsk(pr, tickets)]
    return []
  })
}

type PullRequestState = Pick<ThreadFacet, 'stage' | 'whoseMove' | 'tone' | 'line'>
type StateParts = [
  PullRequestState['stage'],
  PullRequestState['whoseMove'],
  PullRequestState['tone'],
  string,
]

/** Where one of my open pull requests stands and whose move it is; the first matching row wins. */
function statePartsOf(pr: DashboardPR): StateParts {
  if (pr.ciStatus === 'failing') return ['in-review', 'you', 'bad', 'checks failing']
  if (pr.reviewDecision === 'changes-requested') {
    return ['in-review', 'you', 'bad', 'changes requested']
  }
  if (pr.reviewDecision === 'approved') return ['merging', 'you', 'good', 'approved']
  if (pr.isDraft) return ['building', 'you', 'neutral', 'draft']
  if (pr.ciStatus === 'pending') return ['in-review', 'others', 'waiting', 'checks running']
  if (pr.ciStatus === 'passing') return ['in-review', 'others', 'good', 'checks passed']
  return ['in-review', 'others', 'waiting', 'waiting for review']
}

function pullRequestStateOf(pr: DashboardPR): PullRequestState {
  const [stage, whoseMove, tone, text] = statePartsOf(pr)
  return { stage, whoseMove, tone, line: `#${pr.number} ${text}` }
}

/** Failed and running checks one by one, the passed ones as a single line of their names. */
function groupedChecks(checks: DashboardCheck[]): ThreadFacet['checks'] {
  const named = (state: DashboardCheck['state']) =>
    checks.filter((check) => check.state === state).map((check) => check.name)
  const passed = named('passed')
  return [
    ...named('failed').map((name) => ({ name, state: 'failed' as const })),
    ...named('running').map((name) => ({ name, state: 'running' as const })),
    ...(passed.length > 0 ? [{ name: passed.join(', '), state: 'passed' as const }] : []),
  ]
}

interface FacetSource {
  tickets: TicketIndex
  updatedAt: string
}

function facetOf(pr: DashboardPR, { tickets, updatedAt }: FacetSource): ThreadFacet[] {
  const workKey = workKeyOf(pr, tickets)
  if (!workKey) return []
  return [
    {
      workKey,
      kind: 'pull-request',
      title: pr.title,
      url: pr.url,
      closedAt: null,
      updatedAt,
      ...(pr.checks ? { checks: groupedChecks(pr.checks) } : {}),
      ...pullRequestStateOf(pr),
    },
  ]
}

/** One facet per open pull request of mine that can be joined to its work.
 * @internal */
export function buildFacets(
  prs: DashboardPR[],
  tickets: TicketIndex,
  updatedAt: string
): ThreadFacet[] {
  return prs
    .filter((pr) => pr.section === 'mine')
    .flatMap((pr) => facetOf(pr, { tickets, updatedAt }))
}

function mergedFacetOf(pr: MergedPullRequest, tickets: TicketIndex): ThreadFacet[] {
  const workKey = workKeyOf(pr, tickets)
  if (!workKey) return []
  return [
    {
      workKey,
      kind: 'pull-request',
      stage: 'shipped',
      whoseMove: 'others',
      tone: 'good',
      line: `#${pr.number} merged`,
      title: pr.title,
      url: pr.url,
      closedAt: pr.mergedAt,
      openedAt: pr.openedAt,
      readyAt: pr.readyAt,
      firstReviewAt: pr.firstReviewAt,
      checksMinutes: pr.checksMinutes,
      updatedAt: pr.mergedAt,
    },
  ]
}

/** One closed facet per merged pull request of mine that can be joined to its work,
 *  dated by the merge. @internal */
export function buildMergedFacets(
  merged: MergedPullRequest[],
  tickets: TicketIndex
): ThreadFacet[] {
  return merged.flatMap((pr) => mergedFacetOf(pr, tickets))
}

/** Merged pull requests per week, oldest first, over the last `weeks` weeks ending `skip` weeks ago. */
function mergedPerWeek(calendar: ContributionCalendar, weeks: number, skip: number): number[] {
  const end = calendar.weeks.length - skip
  return calendar.weeks
    .slice(end - weeks, end)
    .map((week) => week.reduce((sum, day) => sum + day.merged, 0))
}

const sum = (counts: number[]) => counts.reduce((total, count) => total + count, 0)

/** Contribution levels 0-4 of the last `RAIL_DAYS` days up to today, oldest first. */
function recentLevels(calendar: ContributionCalendar): number[] {
  return calendar.weeks
    .flat()
    .filter((day) => !day.future)
    .slice(-RAIL_DAYS)
    .map((day) => day.level)
}

/** "How much shipped?" and the recent days' levels, from the calendar Insights already fetched.
 * @internal */
export function buildMeasures(calendar: ContributionCalendar | null): HomeMeasure[] {
  if (!calendar) return []
  const series = mergedPerWeek(calendar, WEEKS_IN_QUARTER, 0)
  const levels = recentLevels(calendar)
  return [
    {
      id: HOME_MEASURES.shipped,
      question: 'How much shipped?',
      value: sum(series),
      unit: 'count',
      window: 'quarter',
      series,
      previous: sum(mergedPerWeek(calendar, WEEKS_IN_QUARTER, WEEKS_IN_QUARTER)),
    },
    {
      id: HOME_MEASURES.contributionsDays,
      question: 'When do I ship?',
      value: levels.filter((level) => level > 0).length,
      unit: 'count',
      window: 'quarter',
      series: levels,
    },
  ]
}

/** What the extension has read so far; either source may not have answered yet. */
export interface FeedInputs {
  prs: DashboardPR[]
  tickets: TicketIndex
  calendar: ContributionCalendar | null
  merged: MergedPullRequest[]
  updatedAt: string
}

export function buildGitHomeFeed(inputs: FeedInputs): HomeFeed {
  const { prs, tickets, calendar, merged, updatedAt } = inputs
  return {
    asks: buildAsks(prs, tickets),
    facets: [...buildFacets(prs, tickets, updatedAt), ...buildMergedFacets(merged, tickets)],
    measures: buildMeasures(calendar),
  }
}
