import type { DashboardPR, DashboardSection } from '../schemas/pr-review.schema'
import { queueRiskLevel } from './pr-review-service'
import {
  CHECKS_FIELDS,
  REVIEW_REQUEST_FIELDS,
  checksOf,
  reviewRequestedAtOf,
  type RawContext,
  type RawReviewRequest,
} from './dashboard-checks'

// ─── Dashboard search queries (R1) ─────────────────────────────────────────────
//
// `search does not reliably accept @me` for team-review-requested-user, so LOGIN
// is substituted with the viewer's login before the query is sent.

/** @internal */
export const DASHBOARD_QUERIES: Record<DashboardSection, string> = {
  're-review': 'is:pr is:open archived:false reviewed-by:@me -author:@me sort:created-desc',
  requested: 'is:pr is:open archived:false user-review-requested:@me sort:created-desc',
  team: 'is:pr is:open archived:false team-review-requested-user:LOGIN sort:created-desc',
  mine: 'is:pr is:open author:@me sort:created-desc',
  involved: 'is:pr is:open involves:@me -author:@me sort:created-desc',
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

/** Fields only some sections read, so the others do not pay for them. */
const SECTION_FIELDS: Partial<Record<DashboardSection, string>> = {
  mine: CHECKS_FIELDS,
  requested: REVIEW_REQUEST_FIELDS,
  're-review': REVIEW_REQUEST_FIELDS,
}

const prFields = (section: DashboardSection) => `fragment prFields on PullRequest {
    ${SECTION_FIELDS[section] ?? ''}
    number
    title
    url
    isDraft
    additions
    deletions
    changedFiles
    createdAt
    repository { nameWithOwner }
    headRefName
    author { login }
    reviewDecision
    reviewRequests(first: 10) { totalCount }
    reviewThreads(first: 100) { nodes { isResolved } }
    commits(last: 50) { nodes { commit { oid committedDate statusCheckRollup { state } } } }
    latestReviews(first: 20) { nodes { author { login } submittedAt commit { oid } } }
  }`

/** GitHub's search accepts about 256 characters of query excluding `repo:` qualifiers; 300 qualifiers measured 2 s. */
const REPOS_PER_QUERY = 200

/**
 * One query per section, and with a repository selection one per section per
 * chunk of REPOS_PER_QUERY. GitHub resolves aliased searches one after another
 * within a request, so a combined query costs the sum of every section and
 * returns HTTP 502 once that passes its ~10 s limit.
 */
export function buildSectionQueries(
  login: string,
  repos: string[] = []
): Array<{ section: DashboardSection; query: string }> {
  const chunks: string[][] = []
  for (let i = 0; i < repos.length; i += REPOS_PER_QUERY) {
    chunks.push(repos.slice(i, i + REPOS_PER_QUERY))
  }
  if (chunks.length === 0) chunks.push([])
  return (Object.keys(DASHBOARD_QUERIES) as DashboardSection[]).flatMap((section) =>
    chunks.map((chunk) => {
      const base = DASHBOARD_QUERIES[section].replace('LOGIN', login)
      const search = [base, ...chunk.map((repo) => `repo:${repo}`)].join(' ')
      return {
        section,
        query: `query {
    ${SECTION_ALIASES[section]}: search(query: ${JSON.stringify(search)}, type: ISSUE, first: 50) { issueCount nodes { ...prFields } }
  }
  ${prFields(section)}`,
      }
    })
  )
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
  headRefName?: string
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
  latestChecks?: {
    nodes: Array<{ commit: { statusCheckRollup: { contexts: { nodes: RawContext[] } } | null } }>
  }
  reviewRequestEvents?: { nodes: RawReviewRequest[] }
}

interface RawSearchResult {
  issueCount?: number
  nodes?: unknown[]
}

/** Who is looking, and where their checkouts of each repository are. */
export interface DashboardViewer {
  login: string
  /** owner/name -> local checkout path */
  localRoots: Map<string, string>
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

const CI_STATUSES = new Map<string, DashboardPR['ciStatus']>([
  ['SUCCESS', 'passing'],
  ['FAILURE', 'failing'],
  ['ERROR', 'failing'],
  ['PENDING', 'pending'],
  ['EXPECTED', 'pending'],
])

const REVIEW_DECISIONS = new Map<string, DashboardPR['reviewDecision']>([
  ['APPROVED', 'approved'],
  ['CHANGES_REQUESTED', 'changes-requested'],
  ['REVIEW_REQUIRED', 'review-required'],
])

function mapCiStatus(state: string | null | undefined): DashboardPR['ciStatus'] {
  return CI_STATUSES.get(state ?? '') ?? 'none'
}

function mapReviewDecision(decision: string | null | undefined): DashboardPR['reviewDecision'] {
  return REVIEW_DECISIONS.get(decision ?? '') ?? 'none'
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

function reviewerCountOf(node: RawPrNode): number {
  const reviewers = new Set(node.latestReviews.nodes.map((r) => r.author?.login).filter(Boolean))
  return node.reviewRequests.totalCount + reviewers.size
}

/** Where review of the PR stands for the viewer: CI, decision, threads, new commits. */
function reviewProgressOf(node: RawPrNode, login: string) {
  const latestCommit = node.commits.nodes[node.commits.nodes.length - 1]
  return {
    ciStatus: mapCiStatus(latestCommit?.commit.statusCheckRollup?.state),
    reviewDecision: mapReviewDecision(node.reviewDecision),
    unresolvedThreads: node.reviewThreads.nodes.filter((t) => !t.isResolved).length,
    commitsSinceMyReview: computeCommitsSinceMyReview(node, login),
    reviewerCount: reviewerCountOf(node),
  }
}

/** What only some sections ask for: my checks, and when a review was requested of me. */
function sectionExtrasOf(node: RawPrNode, viewer: DashboardViewer) {
  const contexts = node.latestChecks?.nodes.at(-1)?.commit.statusCheckRollup?.contexts.nodes
  const requestedAt = reviewRequestedAtOf(node.reviewRequestEvents?.nodes ?? [], viewer.login)
  return {
    ...(contexts ? { checks: checksOf(contexts) } : {}),
    ...(requestedAt ? { reviewRequestedAt: requestedAt } : {}),
  }
}

function mapNode(node: RawPrNode, section: DashboardSection, viewer: DashboardViewer): DashboardPR {
  const { additions, deletions } = node
  const repo = node.repository.nameWithOwner
  return {
    repo,
    localRepoRoot: viewer.localRoots.get(repo) ?? null,
    headRefName: node.headRefName ?? '',
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
    ...reviewProgressOf(node, viewer.login),
    ...sectionExtrasOf(node, viewer),
    sessionStatus: 'not-started',
    viewedFileCount: 0,
  }
}

/**
 * Whether a source branch matches Settings → Git → Branch Exclude Patterns,
 * for the local checkout of its repository when there is one.
 */
export type BranchExcluded = (branch: string, repoPath?: string) => boolean

/** The core's answer for one branch, which crosses the extension host's port (SDK 4.0.0). */
export type BranchExclusionQuery = (branch: string, repoPath?: string) => Promise<boolean>

/**
 * Asks about each distinct candidate once, then answers from the replies, so a
 * pure filter such as `parseDashboard` stays synchronous.
 */
export async function resolveBranchExclusions(
  query: BranchExclusionQuery,
  candidates: ReadonlyArray<{ branch: string; repoPath?: string }>
): Promise<BranchExcluded> {
  const keyOf = (branch: string, repoPath?: string) => `${repoPath ?? ''}\0${branch}`
  const distinct = new Map(candidates.map((c) => [keyOf(c.branch, c.repoPath), c]))
  const answers = await Promise.all(
    [...distinct].map(async ([key, c]) => [key, await query(c.branch, c.repoPath)] as const)
  )
  const excluded = new Set(answers.filter(([, isExcluded]) => isExcluded).map(([key]) => key))
  return (branch, repoPath) => excluded.has(keyOf(branch, repoPath))
}

/** Each pull request's branch and local checkout in the raw response, for `resolveBranchExclusions`. */
export function dashboardBranches(
  raw: unknown,
  localRoots: Map<string, string>
): Array<{ branch: string; repoPath?: string }> {
  const data = (raw as RawDashboardResponse).data ?? {}
  return [data.reReview, data.requested, data.team, data.mine, data.involved]
    .flatMap((result) => (result?.nodes ?? []).filter((n): n is RawPrNode => n != null))
    .map((n) => ({
      branch: n.headRefName ?? '',
      repoPath: localRoots.get(n.repository.nameWithOwner),
    }))
}

/** Each section's pull requests, leaving out those opened from an excluded branch. */
function nodesBySection(
  raw: unknown,
  localRoots: Map<string, string>,
  isBranchExcluded: BranchExcluded
): Record<DashboardSection, RawPrNode[]> {
  const data = (raw as RawDashboardResponse).data ?? {}
  const nodesFor = (result: RawSearchResult | undefined): RawPrNode[] =>
    ((result?.nodes ?? []).filter((n): n is RawPrNode => n != null) as RawPrNode[]).filter(
      (n) => !isBranchExcluded(n.headRefName ?? '', localRoots.get(n.repository.nameWithOwner))
    )
  return {
    're-review': nodesFor(data.reReview),
    requested: nodesFor(data.requested),
    team: nodesFor(data.team),
    mine: nodesFor(data.mine),
    involved: nodesFor(data.involved),
  }
}

/** Pure: turns the raw GraphQL response into deduped, section-tagged rows, leaving out pull requests
 *  opened from an excluded branch. */
export function parseDashboard(
  raw: unknown,
  viewer: DashboardViewer,
  isBranchExcluded: BranchExcluded = () => false
): DashboardPR[] {
  const bySection = nodesBySection(raw, viewer.localRoots, isBranchExcluded)
  const results: DashboardPR[] = []
  const seen = new Set<string>() // "owner/name#number"
  for (const section of DEDUPE_ORDER) {
    for (const node of bySection[section]) {
      const key = `${node.repository.nameWithOwner}#${node.number}`
      if (seen.has(key)) continue
      seen.add(key)
      const pr = mapNode(node, section, viewer)
      if (section !== 're-review' || pr.commitsSinceMyReview > 0) results.push(pr)
    }
  }
  return [...results, ...bySection.mine.map((node) => mapNode(node, 'mine', viewer))]
}
