import type { DashboardCheck } from '../schemas/pr-review.schema.js'

// The dashboard query's extra fields for Home (ADR 117): the latest commit's checks on my pull
// requests, and when a review was requested on the others. Fields of the existing search, not searches.

export const CHECKS_FIELDS = `latestChecks: commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 50) { nodes { __typename ... on CheckRun { name status conclusion detailsUrl completedAt } ... on StatusContext { context state targetUrl } } } } } } }`

export const REVIEW_REQUEST_FIELDS = `reviewRequestEvents: timelineItems(last: 10, itemTypes: [REVIEW_REQUESTED_EVENT]) { nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { ... on User { login } } } } }`

/** One check context as GraphQL returns it: a check run, or a commit status. */
export interface RawContext {
  __typename?: string
  name?: string
  status?: string
  conclusion?: string | null
  detailsUrl?: string | null
  completedAt?: string | null
  context?: string
  state?: string
  targetUrl?: string | null
}

export interface RawReviewRequest {
  createdAt: string
  requestedReviewer: { login?: string } | null
}

const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])
const RUNNING = new Set(['PENDING', 'EXPECTED'])

function checkState(raw: RawContext): DashboardCheck['state'] {
  if (raw.__typename === 'StatusContext') {
    if (raw.state === 'SUCCESS') return 'passed'
    return RUNNING.has(raw.state ?? '') ? 'running' : 'failed'
  }
  if (raw.status !== 'COMPLETED') return 'running'
  return PASSED.has(raw.conclusion ?? '') ? 'passed' : 'failed'
}

function checkOf(raw: RawContext): DashboardCheck {
  const detailsUrl = raw.detailsUrl ?? raw.targetUrl
  return {
    name: raw.name ?? raw.context ?? 'check',
    state: checkState(raw),
    ...(detailsUrl ? { detailsUrl } : {}),
    ...(raw.completedAt ? { completedAt: raw.completedAt } : {}),
  }
}

/** The checks of a pull request's latest commit. */
export function checksOf(contexts: RawContext[] | undefined): DashboardCheck[] {
  return (contexts ?? []).map(checkOf)
}

/** When a review was last requested of `login`, else of anyone (a team); undefined without a request. */
export function reviewRequestedAtOf(events: RawReviewRequest[], login: string): string | undefined {
  const latest = (list: RawReviewRequest[]) =>
    list
      .map((e) => e.createdAt)
      .sort()
      .at(-1)
  return latest(events.filter((e) => e.requestedReviewer?.login === login)) ?? latest(events)
}
