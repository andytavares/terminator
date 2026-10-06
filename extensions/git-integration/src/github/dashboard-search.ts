import type { DashboardPR, DashboardSection } from '../schemas/pr-review.schema'
import { queueRiskLevel } from './pr-review-service'

// ─── Dashboard search queries (R1) ─────────────────────────────────────────────
//
// `search does not reliably accept @me` for team-review-requested-user, so LOGIN
// is substituted with the viewer's login before the query is sent.

export const DASHBOARD_QUERIES: Record<DashboardSection, string> = {
  're-review': 'is:pr is:open archived:false reviewed-by:@me -author:@me',
  requested: 'is:pr is:open archived:false user-review-requested:@me',
  team: 'is:pr is:open archived:false team-review-requested-user:LOGIN',
  mine: 'is:pr is:open author:@me',
  involved: 'is:pr is:open involves:@me -author:@me',
}

const SECTION_ALIASES: Record<DashboardSection, string> = {
  're-review': 'reReview',
  requested: 'requested',
  team: 'team',
  mine: 'mine',
  involved: 'involved',
}

// Section priority (highest first) used by parseDashboard's de-dup pass. A PR
// that asks for my review files under 'requested' even when I reviewed it before.
// 'mine' is independent — it never competes with the others.
const DEDUPE_ORDER: DashboardSection[] = ['requested', 're-review', 'team', 'involved']

const PR_FIELDS = `fragment prFields on PullRequest {
    number
    title
    url
    isDraft
    additions
    deletions
    changedFiles
    createdAt
    repository { nameWithOwner }
    author { login }
    reviewDecision
    reviewRequests(first: 10) { totalCount }
    reviewThreads(first: 100) { nodes { isResolved } }
    commits(last: 50) { nodes { commit { oid committedDate statusCheckRollup { state } } } }
    latestReviews(first: 20) { nodes { author { login } submittedAt commit { oid } } }
  }`

/**
 * One query per section. GitHub resolves aliased searches one after another
 * within a request, so a combined query costs the sum of every section and
 * returns HTTP 502 once that passes its ~10 s limit.
 */
export function buildSectionQueries(login: string): Record<DashboardSection, string> {
  const entries = (Object.keys(DASHBOARD_QUERIES) as DashboardSection[]).map((section) => {
    const query = DASHBOARD_QUERIES[section].replace('LOGIN', login)
    const alias = SECTION_ALIASES[section]
    return [
      section,
      `query {
    ${alias}: search(query: ${JSON.stringify(query)}, type: ISSUE, first: 50) { nodes { ...prFields } }
  }
  ${PR_FIELDS}`,
    ]
  })
  return Object.fromEntries(entries) as Record<DashboardSection, string>
}

// ─── Raw GraphQL node shapes ────────────────────────────────────────────────────

interface RawPrNode {
  number: number
  title: string
  url: string
  isDraft: boolean
  additions: number
  deletions: number
  changedFiles: number
  createdAt: string
  repository: { nameWithOwner: string }
  author: { login: string } | null
  reviewDecision: string | null
  reviewRequests: { totalCount: number }
  reviewThreads: { nodes: Array<{ isResolved: boolean }> }
  commits: {
    nodes: Array<{
      commit: { oid: string; committedDate: string; statusCheckRollup: { state: string } | null }
    }>
  }
  latestReviews: {
    nodes: Array<{
      author: { login: string } | null
      submittedAt: string
      commit: { oid: string } | null
    }>
  }
}

interface RawSearchResult {
  nodes?: unknown[]
}

interface RawDashboardResponse {
  data?: {
    reReview?: RawSearchResult
    requested?: RawSearchResult
    team?: RawSearchResult
    mine?: RawSearchResult
    involved?: RawSearchResult
  }
}

function mapCiStatus(state: string | null | undefined): DashboardPR['ciStatus'] {
  switch (state) {
    case 'SUCCESS':
      return 'passing'
    case 'FAILURE':
    case 'ERROR':
      return 'failing'
    case 'PENDING':
    case 'EXPECTED':
      return 'pending'
    default:
      return 'none'
  }
}

function mapReviewDecision(decision: string | null | undefined): DashboardPR['reviewDecision'] {
  switch (decision) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes-requested'
    case 'REVIEW_REQUIRED':
      return 'review-required'
    default:
      return 'none'
  }
}

function computeCommitsSinceMyReview(node: RawPrNode, login: string): number {
  const myReviews = node.latestReviews.nodes.filter((r) => r.author?.login === login)
  if (myReviews.length === 0) return 0
  const latestReviewAt = myReviews.reduce(
    (max, r) => (r.submittedAt > max ? r.submittedAt : max),
    myReviews[0].submittedAt
  )
  return node.commits.nodes.filter((c) => c.commit.committedDate > latestReviewAt).length
}

function mapNode(
  node: RawPrNode,
  section: DashboardSection,
  login: string,
  localRoots: Map<string, string>
): DashboardPR {
  const additions = node.additions
  const deletions = node.deletions
  const latestCommit = node.commits.nodes[node.commits.nodes.length - 1]
  return {
    repo: node.repository.nameWithOwner,
    localRepoRoot: localRoots.get(node.repository.nameWithOwner) ?? null,
    section,
    number: node.number,
    title: node.title,
    url: node.url,
    author: node.author?.login ?? '',
    isDraft: node.isDraft,
    createdAt: node.createdAt,
    additions,
    deletions,
    fileCount: node.changedFiles,
    riskLevel: queueRiskLevel(additions + deletions),
    estimatedMinutes: Math.max(1, Math.ceil((additions + deletions) / 60)),
    ciStatus: mapCiStatus(latestCommit?.commit.statusCheckRollup?.state),
    reviewDecision: mapReviewDecision(node.reviewDecision),
    unresolvedThreads: node.reviewThreads.nodes.filter((t) => !t.isResolved).length,
    commitsSinceMyReview: computeCommitsSinceMyReview(node, login),
    reviewerCount:
      node.reviewRequests.totalCount +
      new Set(node.latestReviews.nodes.map((r) => r.author?.login).filter(Boolean)).size,
  }
}

/** Pure: turns the raw GraphQL response into deduped, section-tagged rows. */
export function parseDashboard(
  raw: unknown,
  login: string,
  localRoots: Map<string, string>
): DashboardPR[] {
  const response = raw as RawDashboardResponse
  const data = response.data ?? {}

  const nodesFor = (result: RawSearchResult | undefined): RawPrNode[] =>
    (result?.nodes ?? []).filter((n): n is RawPrNode => n != null) as RawPrNode[]

  const bySection: Record<DashboardSection, RawPrNode[]> = {
    're-review': nodesFor(data.reReview),
    requested: nodesFor(data.requested),
    team: nodesFor(data.team),
    mine: nodesFor(data.mine),
    involved: nodesFor(data.involved),
  }

  const results: DashboardPR[] = []
  const seen = new Set<string>() // "owner/name#number"

  for (const section of DEDUPE_ORDER) {
    for (const node of bySection[section]) {
      const key = `${node.repository.nameWithOwner}#${node.number}`
      if (seen.has(key)) continue
      seen.add(key)
      const pr = mapNode(node, section, login, localRoots)
      if (section === 're-review' && pr.commitsSinceMyReview <= 0) continue
      results.push(pr)
    }
  }

  for (const node of bySection.mine) {
    results.push(mapNode(node, 'mine', login, localRoots))
  }

  return results
}
