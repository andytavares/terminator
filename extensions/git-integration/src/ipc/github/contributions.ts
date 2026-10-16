import { z } from 'zod'
import { defineChannel, type ChannelSpec } from '@terminator/extension-sdk'
import {
  buildContributionCalendar,
  calendarStart,
  countBetween,
  previousRange,
  type Contribution,
} from '../../review/contribution-calendar.js'
import { VALIDATION_ERROR } from '../register.js'
import { catchError, type GithubContext } from './context.js'

// github:contributions (ADR 108): opened, merged and reviewed searches whose instants
// buildContributionCalendar sums. gh --paginate runs jq per page, so a reply is
// line-delimited JSON: one compact object per node, parsed line by line.

const SEARCH_CAP = 1000
const MAX_SEARCH_DEPTH = 10

/** Today as a YYYY-MM-DD local date, and its zone (ADR 108 rule 3: the clock reads Date). */
function localClock(): { today: string; timeZone: string } {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const today = Temporal.Instant.fromEpochMilliseconds(Date.now())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString()
  return { today, timeZone }
}

/** What one search's jq emits per node: the repository flattened, reviews as submittedAt list. */
interface SearchNode extends Record<string, unknown> {
  repository: string
  number: number
  createdAt?: string | null
  mergedAt?: string | null
  reviews?: Array<string | null>
}

/** The dates one search covers, inclusive, and how far a >1000-result window may split. */
interface ContributionSearch {
  kind: Contribution['kind']
  login: string
  window: { from: string; to: string }
  depth: number
}

// gh --paginate follows a GraphQL collection only when the query takes an $endCursor and
// fetches pageInfo (gh help api), so each query declares both.
const QUERIES: Record<Contribution['kind'], string> = {
  opened: `query($search: String!, $endCursor: String) { search(query: $search, type: ISSUE, first: 100, after: $endCursor) { issueCount pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { number createdAt repository { nameWithOwner } } } } }`,
  merged: `query($search: String!, $endCursor: String) { search(query: $search, type: ISSUE, first: 100, after: $endCursor) { issueCount pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { number mergedAt repository { nameWithOwner } } } } }`,
  reviewed: `query($search: String!, $login: String!, $endCursor: String) { search(query: $search, type: ISSUE, first: 100, after: $endCursor) { issueCount pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { number repository { nameWithOwner } reviews(author: $login, first: 100) { nodes { submittedAt } } } } } }`,
}

// The first line carries the search's issueCount; one line per node follows, with the
// repository and its reviews flattened, so an empty result still reports its count and
// the >1000 split is not skipped.
const SEARCH_JQ = `.data.search | {issueCount}, (.nodes[] | {number, createdAt, mergedAt, repository: .repository.nameWithOwner, reviews: [.reviews.nodes[]? | .submittedAt]})`

function searchText(search: ContributionSearch): string {
  const range = `${search.window.from}..${search.window.to}`
  if (search.kind === 'opened') return `is:pr author:${search.login} created:${range}`
  if (search.kind === 'merged') return `is:pr author:${search.login} is:merged merged:${range}`
  return `is:pr reviewed-by:${search.login} -author:${search.login} updated:${range}`
}

/** One windowed search's parsed output: how many GitHub matched, and its nodes. */
interface SearchResult {
  issueCount: number
  nodes: SearchNode[]
}

/** Runs one windowed search through gh and parses the line-delimited JSON it prints. */
async function runContributionSearch(
  ctx: GithubContext,
  search: ContributionSearch
): Promise<SearchResult> {
  const raw = await ctx.api(ctx.noCheckoutCwd, {
    path: 'graphql',
    fields: { query: QUERIES[search.kind], search: searchText(search), login: search.login },
    paginate: true,
    jq: SEARCH_JQ,
    timeoutMs: 60_000,
  })
  const lines = raw.split('\n').filter((line) => line.trim())
  let issueCount = 0
  const nodes: SearchNode[] = []
  for (const line of lines) {
    const parsed = JSON.parse(line) as { issueCount?: number } & SearchNode
    if (parsed.number === undefined) issueCount = parsed.issueCount ?? 0
    else nodes.push(parsed)
  }
  return { issueCount, nodes }
}

/** Half-open halves of a date window: [from, mid] and [mid + 1 day, to]. */
function halve(window: { from: string; to: string }): [typeof window, typeof window] {
  const from = Temporal.PlainDate.from(window.from)
  const days = Math.floor(from.until(Temporal.PlainDate.from(window.to)).days / 2)
  const mid = from.add({ days })
  return [
    { from: window.from, to: mid.toString() },
    { from: mid.add({ days: 1 }).toString(), to: window.to },
  ]
}

/** The unique nodes of one window's search; over the cap, the halves searched and merged. */
async function searchWindow(ctx: GithubContext, search: ContributionSearch): Promise<SearchNode[]> {
  const result = await runContributionSearch(ctx, search)
  const unsplittable = search.depth >= MAX_SEARCH_DEPTH || search.window.from === search.window.to
  if (result.issueCount <= SEARCH_CAP || unsplittable) return result.nodes
  const halves = halve(search.window).map((window) => ({
    ...search,
    window,
    depth: search.depth + 1,
  }))
  const found = await Promise.all(halves.map((half) => searchWindow(ctx, half)))
  const seen = new Set<number>()
  return found
    .flat()
    .filter((node) => (seen.has(node.number) ? false : (seen.add(node.number), true)))
}

/** One node as its contributions: merged counts at mergedAt; each submitted review once. */
function contributionsOf(
  kind: Contribution['kind'],
  since: string,
  node: SearchNode
): Contribution[] {
  const repo = node.repository
  if (kind === 'opened') return node.createdAt ? [{ kind, at: node.createdAt, repo }] : []
  if (kind === 'merged') return node.mergedAt ? [{ kind, at: node.mergedAt, repo }] : []
  return (node.reviews ?? [])
    .filter((submittedAt) => submittedAt !== null && submittedAt >= since)
    .map((submittedAt) => ({ kind, at: submittedAt!, repo }))
}

/** The viewer's contributions of every kind since `since`, all three searches concurrent. */
async function fetchContributions(ctx: GithubContext, since: string): Promise<Contribution[]> {
  const login = await ctx.viewer(ctx.noCheckoutCwd)
  const window = { from: since, to: localClock().today }
  const kinds: Contribution['kind'][] = ['opened', 'merged', 'reviewed']
  const searches = kinds.map((kind) => ({ kind, login, window, depth: 0 }))
  const found = await Promise.all(searches.map((search) => searchWindow(ctx, search)))
  return searches.flatMap((search, i) =>
    found[i].flatMap((node) => contributionsOf(search.kind, since, node))
  )
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const payloadSchema = z.object({
  from: z.string().regex(DATE),
  to: z.string().regex(DATE),
  repo: z.string().optional(),
  refresh: z.boolean().optional(),
})
type Payload = z.infer<typeof payloadSchema>

/** The channel's answer: the calendar and the two periods from the (cached) contributions. */
function answer(
  contributions: Contribution[],
  payload: Payload,
  clock: { today: string; timeZone: string }
) {
  const range = { from: payload.from, to: payload.to }
  const inRepo = payload.repo ? contributions.filter((c) => c.repo === payload.repo) : contributions
  return {
    calendar: buildContributionCalendar(inRepo, clock.today, clock.timeZone),
    period: countBetween(inRepo, range, clock.timeZone),
    previous: countBetween(inRepo, previousRange(range), clock.timeZone),
    repos: [...new Set(contributions.map((c) => c.repo))].sort(),
    fetchedAt: new Date().toISOString(),
  }
}

export function contributionsChannels(ctx: GithubContext): ChannelSpec[] {
  // The fetched list per `since`, kept until it fails, as ctx's other lookups are;
  // `refresh: true` asks GitHub again.
  const fetches = new Map<string, Promise<Contribution[]>>()
  const fetchOnce = (payload: Payload, since: string) => {
    if (payload.refresh) fetches.delete(since)
    let pending = fetches.get(since)
    if (!pending) {
      pending = fetchContributions(ctx, since)
      fetches.set(since, pending)
      pending.catch(() => fetches.delete(since))
    }
    return pending
  }
  const run = async (payload: Payload) => {
    const clock = localClock()
    const since = [calendarStart(clock.today), previousRange(payload).from].sort()[0]
    return answer(await fetchOnce(payload, since), payload, clock)
  }
  return [
    defineChannel({
      channel: 'github:contributions',
      schema: payloadSchema,
      invalid: VALIDATION_ERROR,
      run,
      onError: catchError,
    }),
  ]
}
