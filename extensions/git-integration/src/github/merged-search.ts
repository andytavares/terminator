// The merged-pull-request search for Home (ADR 117): one search, run apart from the dashboard
// refresh, that reads each pull request's timeline so Insights can say where the time went.

/** How far back Home looks for merged pull requests.
 * @internal */
export const MERGED_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60_000

/** The query for my pull requests merged since `MERGED_DAYS` before `now`. */
export function mergedQuery(now: number): string {
  const since = new Date(now - MERGED_DAYS * DAY_MS).toISOString().slice(0, 10)
  const search = `is:pr author:@me is:merged merged:>=${since}`
  return `query {
    merged: search(query: ${JSON.stringify(search)}, type: ISSUE, first: 50) {
      nodes { ... on PullRequest {
        number title url headRefName createdAt mergedAt
        author { login }
        repository { nameWithOwner }
        readyEvents: timelineItems(first: 1, itemTypes: [READY_FOR_REVIEW_EVENT]) { nodes { ... on ReadyForReviewEvent { createdAt } } }
        reviews(first: 10) { nodes { author { login } submittedAt } }
        lastCommit: commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 50) { nodes { __typename ... on CheckRun { startedAt completedAt } } } } } } }
      } }
    }
  }`
}

/** One merged pull request of mine and the times its timeline gave. */
export interface MergedPullRequest {
  repo: string
  number: number
  title: string
  url: string
  headRefName: string
  localRepoRoot: string | null
  openedAt: string
  /** The first time it left draft, else when it was opened. */
  readyAt: string
  /** The first review by someone else; null when nobody reviewed. */
  firstReviewAt: string | null
  mergedAt: string
  /** Minutes the last commit's check runs took, summed; null when no run has both times. */
  checksMinutes: number | null
}

interface RawMergedNode {
  number: number
  title: string
  url: string
  headRefName: string
  createdAt: string
  mergedAt: string
  author: { login: string } | null
  repository: { nameWithOwner: string }
  readyEvents: { nodes: Array<{ createdAt: string }> }
  reviews: { nodes: Array<{ author: { login: string } | null; submittedAt: string }> }
  lastCommit: {
    nodes: Array<{
      commit: {
        statusCheckRollup: {
          contexts: { nodes: Array<{ startedAt?: string | null; completedAt?: string | null }> }
        } | null
      }
    }>
  }
}

function firstReviewAtOf(node: RawMergedNode): string | null {
  const others = node.reviews.nodes.filter((review) => review.author?.login !== node.author?.login)
  return others.map((review) => review.submittedAt).sort()[0] ?? null
}

function checksMinutesOf(node: RawMergedNode): number | null {
  const runs = node.lastCommit.nodes.at(-1)?.commit.statusCheckRollup?.contexts.nodes ?? []
  const durations = runs.flatMap((run) =>
    run.startedAt && run.completedAt
      ? [Date.parse(run.completedAt) - Date.parse(run.startedAt)]
      : []
  )
  if (durations.length === 0) return null
  return durations.reduce((total, ms) => total + ms, 0) / MINUTE_MS
}

function mergedOf(node: RawMergedNode, localRoots: Map<string, string>): MergedPullRequest {
  const repo = node.repository.nameWithOwner
  return {
    repo,
    number: node.number,
    title: node.title,
    url: node.url,
    headRefName: node.headRefName,
    localRepoRoot: localRoots.get(repo) ?? null,
    openedAt: node.createdAt,
    readyAt: node.readyEvents.nodes[0]?.createdAt ?? node.createdAt,
    firstReviewAt: firstReviewAtOf(node),
    mergedAt: node.mergedAt,
    checksMinutes: checksMinutesOf(node),
  }
}

/** Pure: the search response as merged pull requests; a null node (no access) is left out. */
export function parseMerged(raw: unknown, localRoots: Map<string, string>): MergedPullRequest[] {
  const nodes = (raw as { data?: { merged?: { nodes?: unknown[] } } }).data?.merged?.nodes ?? []
  return nodes
    .filter((node): node is RawMergedNode => node != null)
    .map((node) => mergedOf(node, localRoots))
}
