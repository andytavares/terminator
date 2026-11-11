import { defineChannel, type ChannelSpec } from '@terminator/extension-sdk'
import type { PrReviewDetail } from '../../schemas/pr-review.schema.js'
import {
  buildChapters,
  extractIssueRefs,
  enrichIssueRefs,
  detectDryViolations,
  mapMergeStateStatus,
  mapCiStatus,
  mapCheckStatus,
  LINT_CHECK_NAMES,
  mapStatusChecks,
  mapApprovals,
} from '../../github/pr-review-service.js'
import { analysePr } from '../../review/analyse.js'
import { applyReadingOrder } from '../../review/apply-reading-order.js'
import { ownedFilesOf } from './owned-files.js'
import { VALIDATION_ERROR } from '../register.js'
import { catchError, PullRequestPayload, type GithubContext } from './context.js'
import { assigneeLoginsOf, asText } from '../../github/pr-review-service.js'

type RawRecord = Record<string, unknown>

/** What GitHub returns for one PR: gh's view, its changed files, reviews and requested reviewers. */
interface PrSources {
  meta: RawRecord
  files: RawRecord[]
  reviews: RawRecord[]
  reviewers: { users?: RawRecord[]; teams?: RawRecord[] }
}

/** A checkout and the REST path of its GitHub repository, `repos/<owner>/<name>`. */
interface RepoAt {
  repoRoot: string
  repoPath: string
}

/** A pull request of a checkout. */
interface PrAt {
  repoRoot: string
  prNumber: number
}

const PR_DETAIL_FIELDS = [
  'id',
  'number',
  'title',
  'body',
  'author',
  'createdAt',
  'headRefName',
  'baseRefName',
  'headRefOid',
  'isDraft',
  'state',
  'mergeStateStatus',
  'statusCheckRollup',
  'assignees',
]

async function fetchPrSources(ctx: GithubContext, at: PrAt, pull: string): Promise<PrSources> {
  const { repoRoot } = at
  const [meta, filesRaw, reviewsRaw, reviewersRaw] = await Promise.all([
    ctx.github.pullRequests.view(ctx.target(repoRoot), at.prNumber, PR_DETAIL_FIELDS),
    // The REST file list carries each patch, which the import-graph grouping reads.
    ctx.api(repoRoot, { path: `${pull}/files`, paginate: true }),
    ctx.api(repoRoot, { path: `${pull}/reviews` }).catch(() => '[]'),
    ctx
      .api(repoRoot, { path: `${pull}/requested_reviewers` })
      .catch(() => '{"users":[],"teams":[]}'),
  ])
  return {
    meta,
    files: JSON.parse(filesRaw) as RawRecord[],
    reviews: JSON.parse(reviewsRaw) as RawRecord[],
    reviewers: JSON.parse(reviewersRaw) as PrSources['reviewers'],
  }
}

/** The file diffs of this PR read these patches instead of asking GitHub for the files again. */
function rememberPatches(ctx: GithubContext, at: PrAt, sources: PrSources): void {
  const { meta, files } = sources
  const patches = new Map(files.map((f) => [filePathOf(f), f.patch ? String(f.patch) : undefined]))
  ctx.prPatches.set(`${at.repoRoot}#${at.prNumber}`, { headSHA: asText(meta.headRefOid), patches })
}

function filePathOf(f: RawRecord): string {
  return String(f.filename ?? f.path ?? '')
}

function requestedReviewersOf(reviewers: PrSources['reviewers']): string[] {
  const users = (reviewers.users ?? []).map((u) => String(u.login ?? ''))
  const teams = (reviewers.teams ?? []).map((t) => String(t.slug ?? t.name ?? ''))
  return [...users, ...teams].filter(Boolean)
}

/** The PR's check rollup; when empty (checks queued, not yet reported), its head's check suites, so
 *  "Expected" checks show. Best-effort: a failed lookup keeps the rollup. */
async function checkRollup(ctx: GithubContext, meta: RawRecord, where: RepoAt) {
  const rollup = meta.statusCheckRollup
  const headSHA = String(meta.headRefOid)
  if (Array.isArray(rollup) && rollup.length > 0) return rollup
  try {
    const suitesRaw = await ctx.api(where.repoRoot, {
      path: `${where.repoPath}/commits/${headSHA}/check-suites`,
      jq: '[.check_suites[] | {name: .app.name, state: .status, conclusion}]',
    })
    const suites = JSON.parse(suitesRaw) as RawRecord[]
    if (suites.length === 0) return rollup
    return suites.map((s) => ({
      name: s.name,
      conclusion: s.conclusion ?? s.state,
      state: s.state,
    }))
  } catch {
    return rollup
  }
}

function stateOf(meta: RawRecord): PrReviewDetail['state'] {
  const state = asText(meta.state).toLowerCase()
  return state === 'merged' || state === 'closed' ? state : 'open'
}

/** Who opened the PR, when, from which branch, and where it stands. */
function prIdentity(meta: RawRecord) {
  const author = (meta.author ?? {}) as RawRecord
  return {
    number: Number(meta.number),
    title: asText(meta.title),
    body: asText(meta.body),
    author: asText(author.login),
    authorAvatarUrl: asText(author.avatarUrl),
    openedAt: asText(meta.createdAt),
    headRefName: asText(meta.headRefName),
    baseRefName: asText(meta.baseRefName),
    headSHA: asText(meta.headRefOid),
    nodeId: typeof meta.id === 'string' ? meta.id : undefined,
    isDraft: Boolean(meta.isDraft),
    state: stateOf(meta),
    mergeStateStatus: mapMergeStateStatus(asText(meta.mergeStateStatus)),
  }
}

function checkFields(rollup: unknown) {
  return {
    ciStatus: mapCiStatus(rollup),
    lintStatus: mapCheckStatus(rollup, LINT_CHECK_NAMES),
    statusChecks: mapStatusChecks(rollup),
  }
}

/** Definitions-first order, moved code and insights (R3, S4, R4). Never throws. */
function analysisOf(
  files: RawRecord[],
  found: Pick<Parameters<typeof analysePr>[1], 'chapters' | 'dryViolations'>
) {
  return analysePr(files, { ...found, readingOrder: [] })
}

/** Issue keys in the PR body; a bare key tells a reviewer nothing, so the tracker adds title and state. */
function issueRefsOf(ctx: GithubContext, meta: RawRecord) {
  return enrichIssueRefs(extractIssueRefs(String(meta.body ?? '')), ctx.options.issues)
}

function dryViolationsIn(files: RawRecord[]) {
  const patches = files.map((f) => ({
    path: filePathOf(f),
    patch: f.patch ? String(f.patch) : undefined,
  }))
  return detectDryViolations(patches)
}

/** Who approved, who is asked to review, and who is assigned. */
function reviewersOf(sources: PrSources) {
  return {
    approvals: mapApprovals(sources.reviews),
    requestedReviewers: requestedReviewersOf(sources.reviewers),
    assigneeLogins: assigneeLoginsOf(sources.meta),
  }
}

/** What the owned-files lookup needs: the base branch whose CODEOWNERS counts and the changed paths. */
function ownerLookupOf(at: PrAt, repoPath: string, sources: PrSources) {
  return {
    repoRoot: at.repoRoot,
    repoPath,
    baseRefName: asText(sources.meta.baseRefName),
    paths: sources.files.map(filePathOf),
  }
}

async function prDetail(ctx: GithubContext, at: PrAt): Promise<{ pr: PrReviewDetail }> {
  const { owner, repo } = await ctx.ownerAndName(at.repoRoot)
  const repoPath = `repos/${owner}/${repo}`
  const sources = await fetchPrSources(ctx, at, `${repoPath}/pulls/${at.prNumber}`)
  const { meta, files } = sources
  rememberPatches(ctx, at, sources)
  const chapters = buildChapters(files)
  const issueRefs = await issueRefsOf(ctx, meta)
  const dryViolations = dryViolationsIn(files)
  const rollup = await checkRollup(ctx, meta, { repoRoot: at.repoRoot, repoPath })
  const analysis = await analysisOf(files, { chapters, dryViolations })
  const pr: PrReviewDetail = {
    ...prIdentity(meta),
    ...checkFields(rollup),
    ...reviewersOf(sources),
    chapters: applyReadingOrder(chapters, analysis.readingOrder),
    issueRefs,
    dryViolations,
    readingOrder: analysis.readingOrder,
    movedBlocks: analysis.movedBlocks,
    insights: analysis.insights,
    ownedPaths: await ownedFilesOf(ctx, ownerLookupOf(at, repoPath, sources)),
  }
  return { pr }
}

export function prDetailChannels(ctx: GithubContext): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'github:pr-review-detail',
      schema: PullRequestPayload,
      invalid: VALIDATION_ERROR,
      run: ({ repoRoot, prNumber }) => prDetail(ctx, { repoRoot, prNumber }),
      onError: catchError,
    }),
  ]
}
