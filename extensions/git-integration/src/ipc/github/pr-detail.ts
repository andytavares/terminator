import { defineChannel, type ChannelSpec } from '@terminator/extension-sdk'
import type { Chapter, PrReviewDetail } from '../../schemas/pr-review.schema.js'
import {
  buildChapters,
  extractIssueRefs,
  enrichIssueRefs,
  detectDryViolations,
  mapMergeStateStatus,
  mapCiStatus,
  mapCheckStatus,
  LINT_CHECK_NAMES,
  COVERAGE_CHECK_NAMES,
  mapStatusChecks,
  mapApprovals,
} from '../../github/pr-review-service.js'
import { computeCoChangeAffinityFromGit } from '../../github/gh-cli.js'
import { runGit } from '../../shell/run-git.js'
import { analysePr } from '../../review/analyse.js'
import { applyReadingOrder } from '../../review/apply-reading-order.js'
import { findTestReferencesInRepo } from '../../review/test-references.js'
import { VALIDATION_ERROR } from '../register.js'
import { catchError, PullRequestPayload, type GithubContext } from './context.js'

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

function filePathOf(f: RawRecord): string {
  return String(f.filename ?? f.path ?? '')
}

function requestedReviewersOf(reviewers: PrSources['reviewers']): string[] {
  const users = (reviewers.users ?? []).map((u) => String(u.login ?? ''))
  const teams = (reviewers.teams ?? []).map((t) => String(t.slug ?? t.name ?? ''))
  return [...users, ...teams].filter(Boolean)
}

function assigneeLoginsOf(meta: RawRecord): string[] {
  const assignees = (meta.assignees as RawRecord[] | undefined) ?? []
  return assignees.map((a) => String(a.login ?? '')).filter(Boolean)
}

/** The PR's check rollup; when empty (checks queued, not yet reported), its head's check suites, so
 *  "Expected" checks show. Best-effort: a failed lookup keeps the rollup. */
async function checkRollup(ctx: GithubContext, meta: RawRecord, where: RepoAt) {
  const rollup = meta.statusCheckRollup
  const headSHA = String(meta.headRefOid ?? '')
  if ((Array.isArray(rollup) && rollup.length > 0) || !headSHA) return rollup
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

function textOf(value: unknown): string {
  return String(value ?? '')
}

/** Who opened the PR, when, from which branch, and where it stands. */
function prIdentity(meta: RawRecord) {
  const author = (meta.author ?? {}) as RawRecord
  return {
    number: Number(meta.number),
    title: textOf(meta.title),
    body: textOf(meta.body),
    author: textOf(author.login),
    authorAvatarUrl: textOf(author.avatarUrl),
    openedAt: textOf(meta.createdAt),
    headRefName: textOf(meta.headRefName),
    baseRefName: textOf(meta.baseRefName),
    headSHA: textOf(meta.headRefOid),
    nodeId: typeof meta.id === 'string' ? meta.id : undefined,
    isDraft: Boolean(meta.isDraft),
    mergeStateStatus: mapMergeStateStatus(textOf(meta.mergeStateStatus)),
  }
}

function checkFields(rollup: unknown) {
  return {
    ciStatus: mapCiStatus(rollup),
    lintStatus: mapCheckStatus(rollup, LINT_CHECK_NAMES),
    coverageStatus: mapCheckStatus(rollup, COVERAGE_CHECK_NAMES),
    statusChecks: mapStatusChecks(rollup),
  }
}

/** The rollup as the insights pass reads it: each check's name, state and description. */
function insightChecks(rollup: unknown) {
  if (!Array.isArray(rollup)) return []
  return (rollup as RawRecord[]).map((c) => ({
    name: String(c.name ?? c.context ?? ''),
    state: String(c.conclusion ?? c.state ?? ''),
    description: c.description ? String(c.description) : undefined,
  }))
}

/** Chapters grouped by meaning, git history (co-change) and imports. */
async function chaptersFor(repoRoot: string, files: RawRecord[]): Promise<Chapter[]> {
  const coChangeAffinity = await computeCoChangeAffinityFromGit(repoRoot, files.map(filePathOf))
  return buildChapters(files, undefined, coChangeAffinity)
}

/** Definitions-first order, moved code and insights (R3, S4, R4). Never throws. */
function analysisOf(
  repoRoot: string,
  files: RawRecord[],
  found: Pick<Parameters<typeof analysePr>[1], 'chapters' | 'statusChecks' | 'dryViolations'>
) {
  return analysePr(files, {
    ...found,
    readingOrder: [],
    localCoverage: null,
    findTestReferences: (symbols) => findTestReferencesInRepo(repoRoot, symbols, runGit),
  })
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

async function prDetail(ctx: GithubContext, at: PrAt): Promise<{ pr: PrReviewDetail }> {
  const { owner, repo } = await ctx.ownerAndName(at.repoRoot)
  const repoPath = `repos/${owner}/${repo}`
  const sources = await fetchPrSources(ctx, at, `${repoPath}/pulls/${at.prNumber}`)
  const { meta, files } = sources
  const chapters = await chaptersFor(at.repoRoot, files)
  const issueRefs = await issueRefsOf(ctx, meta)
  const dryViolations = dryViolationsIn(files)
  const rollup = await checkRollup(ctx, meta, { repoRoot: at.repoRoot, repoPath })
  const analysis = await analysisOf(at.repoRoot, files, {
    chapters,
    statusChecks: insightChecks(rollup),
    dryViolations,
  })
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
