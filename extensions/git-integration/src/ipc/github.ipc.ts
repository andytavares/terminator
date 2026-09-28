import { z } from 'zod'
import Store from 'electron-store'
import { basename, join } from 'path'
import { existsSync } from 'fs'
import { readFile, writeFile, unlink } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import type {
  ReviewQueuePR,
  PrReviewDetail,
  InlineComment,
  IssueComment,
  ReviewSession,
} from '../schemas/pr-review.schema.js'
import { ReviewSessionSchema } from '../schemas/pr-review.schema.js'
import { buildDashboardQuery, parseDashboard } from '../github/dashboard-search.js'
import {
  buildChapters,
  parseReviewQueuePR,
  extractIssueRefs,
  enrichIssueRefs,
  detectDryViolations,
  normalizeGraphQLNode,
  mapMergeStateStatus,
  mapCiStatus,
  mapCheckStatus,
  LINT_CHECK_NAMES,
  COVERAGE_CHECK_NAMES,
  mapStatusChecks,
  mapApprovals,
  mapIssueComment,
  mapComment,
  parseDiff,
} from '../github/pr-review-service.js'
import {
  type GhOptions,
  isAuthError,
  runGh,
  runGit,
  getRepoOwnerAndName,
  PR_JSON_FIELDS,
  computeCoChangeAffinityFromGit,
} from '../github/gh-cli.js'
import { analysePr } from '../review/analyse.js'
import { applyReadingOrder } from '../review/apply-reading-order.js'
import { findTestReferencesInRepo } from '../review/test-references.js'
import { findTestLocations, symbolsForBlock } from '../review/test-locations.js'

type RegisterFn = (
  channel: string,
  handler: (payload: unknown) => Promise<unknown> | unknown
) => void

const sessionStore = new Store<Record<string, unknown>>({ name: 'pr-review-sessions' })
const activeReviewStore = new Store<Record<string, unknown>>({ name: 'pr-active-reviews' })

// ─── Registration ─────────────────────────────────────────────────────────────

/** The application's tracker connection, when this build's host offers one. */
type IssuesApi = Parameters<typeof enrichIssueRefs>[1]

// A repoRoot of the form `gh:owner/name` means "no local checkout" — every PR
// action still goes through the gh CLI (via GH_REPO), it just never touches git.
export function parseRemoteRepo(root: string): { owner: string; name: string } | null {
  if (!root.startsWith('gh:')) return null
  const rest = root.slice('gh:'.length)
  const parts = rest.split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return { owner: parts[0], name: parts[1] }
}

async function runGhForRemote(
  owner: string,
  name: string,
  args: string[],
  opts: GhOptions,
  timeoutMs?: number
): Promise<string> {
  return runGh(homedir(), args, opts, timeoutMs, { GH_REPO: `${owner}/${name}` })
}

export function registerGithubHandlers(
  register: RegisterFn,
  opts: GhOptions,
  issues?: IssuesApi,
  listProjectRoots?: () => string[]
): void {
  const gh = (cwd: string, args: string[], timeoutMs?: number) => {
    const remote = parseRemoteRepo(cwd)
    if (remote) return runGhForRemote(remote.owner, remote.name, args, opts, timeoutMs)
    return runGh(cwd, args, opts, timeoutMs)
  }
  const ownerAndName = (repoRoot: string) => {
    const remote = parseRemoteRepo(repoRoot)
    if (remote) return Promise.resolve({ owner: remote.owner, repo: remote.name })
    return getRepoOwnerAndName(repoRoot, opts)
  }
  const catchError = (e: unknown) => {
    if (isAuthError(e)) return { error: 'NOT_AUTHENTICATED' as const }
    const msg = String(e)
    if (msg.includes('rate limit') || msg.includes('API rate limit')) {
      return { error: 'RATE_LIMITED' as const, resetAt: Date.now() + 60_000 }
    }
    return { error: msg }
  }

  register('github:current-user', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot } = parsed.data
    try {
      const raw = await gh(repoRoot, ['api', 'user', '--jq', '.login'])
      return { login: raw.trim() }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('github:list-open-prs', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      cursor: z.string().optional(),
      search: z.string().optional(),
      includeClosedPrs: z.boolean().optional(),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, cursor, search, includeClosedPrs } = parsed.data

    try {
      // PR number lookup — always finds the PR regardless of state
      if (search && /^\d+$/.test(search.trim())) {
        const raw = await gh(repoRoot, ['pr', 'view', search.trim(), '--json', PR_JSON_FIELDS])
        const pr = parseReviewQueuePR(JSON.parse(raw))
        return { prs: [pr], totalCount: 1, hasMore: false }
      }

      // Text search — always searches all states so nothing is missed
      if (search && search.trim()) {
        const raw = await gh(repoRoot, [
          'pr',
          'list',
          '--state',
          'all',
          '--search',
          search.trim(),
          '--limit',
          '50',
          '--json',
          PR_JSON_FIELDS,
        ])
        const prs: ReviewQueuePR[] = (JSON.parse(raw) as unknown[]).map(parseReviewQueuePR)
        return { prs, totalCount: prs.length, hasMore: false }
      }

      // Paginated load via GraphQL
      const { owner, repo } = await ownerAndName(repoRoot)
      const gqlStates = includeClosedPrs ? '[OPEN,CLOSED,MERGED]' : 'OPEN'
      const gql = `query($owner:String!,$repo:String!,$cursor:String){repository(owner:$owner,name:$repo){pullRequests(first:20,states:${gqlStates},after:$cursor,orderBy:{field:CREATED_AT,direction:DESC}){totalCount pageInfo{endCursor hasNextPage}nodes{number title isDraft additions deletions createdAt headRefName baseRefName changedFiles mergeStateStatus author{login avatarUrl}assignees(first:10){nodes{login}}latestReviews(first:20){nodes{author{login avatarUrl}state submittedAt}}reviewRequests(first:10){nodes{requestedReviewer{...on User{login avatarUrl}...on Team{name}}}}commits(last:1){nodes{commit{statusCheckRollup{contexts(first:20){nodes{...on CheckRun{name conclusion status}...on StatusContext{context state}}}}}}}}}}}`
      const args = [
        'api',
        'graphql',
        '-f',
        `query=${gql}`,
        '-f',
        `owner=${owner}`,
        '-f',
        `repo=${repo}`,
      ]
      if (cursor) args.push('-f', `cursor=${cursor}`)

      const raw = await gh(repoRoot, args, 60_000)
      type GQLResponse = {
        data: {
          repository: {
            pullRequests: {
              totalCount: number
              pageInfo: { endCursor: string; hasNextPage: boolean }
              nodes: unknown[]
            }
          }
        }
      }
      const data = JSON.parse(raw) as GQLResponse
      const { nodes, pageInfo, totalCount } = data.data.repository.pullRequests
      const prs: ReviewQueuePR[] = nodes.map((n) => parseReviewQueuePR(normalizeGraphQLNode(n)))
      return {
        prs,
        // The count the summary line reports. Without it the view can only
        // count the rows it happens to hold, which is the page size — so a
        // repository with 47 open PRs said "20 waiting on you".
        totalCount,
        hasMore: pageInfo.hasNextPage,
        nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : undefined,
      }
    } catch (e) {
      return catchError(e)
    }
  })

  register('github:pr-review-detail', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), prNumber: z.number().int().positive() })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber } = parsed.data
    try {
      const { owner, repo } = await ownerAndName(repoRoot)
      const [metaRaw, filesRaw, reviewsRaw, reviewersRaw] = await Promise.all([
        gh(repoRoot, [
          'pr',
          'view',
          String(prNumber),
          '--json',
          'number,title,body,author,createdAt,headRefName,baseRefName,headRefOid,isDraft,mergeStateStatus,statusCheckRollup,assignees',
        ]),
        // Use REST API to get file list with patch content for import-graph grouping
        gh(repoRoot, ['api', '--paginate', `repos/${owner}/${repo}/pulls/${prNumber}/files`]),
        gh(repoRoot, ['api', `repos/${owner}/${repo}/pulls/${prNumber}/reviews`]).catch(() => '[]'),
        gh(repoRoot, ['api', `repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`]).catch(
          () => '{"users":[],"teams":[]}'
        ),
      ])
      const meta = JSON.parse(metaRaw) as Record<string, unknown>
      const filesData = JSON.parse(filesRaw) as unknown[]
      const reviewsData = JSON.parse(reviewsRaw) as Array<Record<string, unknown>>
      const reviewersData = JSON.parse(reviewersRaw) as {
        users?: Array<Record<string, unknown>>
        teams?: Array<Record<string, unknown>>
      }
      const requestedReviewers = [
        ...(reviewersData.users ?? []).map((u) => String(u.login ?? '')),
        ...(reviewersData.teams ?? []).map((t) => String(t.slug ?? t.name ?? '')),
      ].filter(Boolean)
      const assigneeLogins = ((meta.assignees as Array<Record<string, unknown>> | undefined) ?? [])
        .map((a) => String(a.login ?? ''))
        .filter(Boolean)

      // Compute co-change affinity for universal chapter grouping (language-agnostic Signal 3)
      const filePaths = filesData.map((f) =>
        String((f as Record<string, unknown>).filename ?? (f as Record<string, unknown>).path ?? '')
      )
      const coChangeAffinity = await computeCoChangeAffinityFromGit(repoRoot, filePaths)
      const chapters = buildChapters(filesData, undefined, coChangeAffinity)

      // Issue refs from the PR body, with title and state filled in from the
      // application's tracker connection where there is one. A bare key tells
      // a reviewer nothing.
      const issueRefs = await enrichIssueRefs(extractIssueRefs(String(meta.body ?? '')), issues)

      // Detect DRY violations across all changed files
      const patchFiles = filesData.map((f) => {
        const obj = f as Record<string, unknown>
        return {
          path: String(obj.filename ?? obj.path ?? ''),
          patch: obj.patch ? String(obj.patch) : undefined,
        }
      })
      const dryViolations = detectDryViolations(patchFiles)

      // When statusCheckRollup is null/empty (checks queued but not yet reported),
      // fall back to check-suites so "Expected" checks are visible.
      let rollup = meta.statusCheckRollup
      if (!rollup || !Array.isArray(rollup) || rollup.length === 0) {
        try {
          const headSHA = String(meta.headRefOid ?? '')
          if (headSHA) {
            const suitesRaw = await gh(repoRoot, [
              'api',
              `repos/${owner}/${repo}/commits/${headSHA}/check-suites`,
              '--jq',
              '[.check_suites[] | {name: .app.name, state: .status, conclusion}]',
            ])
            const suites = JSON.parse(suitesRaw) as Array<Record<string, unknown>>
            if (suites.length > 0) {
              rollup = suites.map((s) => ({
                name: s.name,
                conclusion: s.conclusion ?? s.state,
                state: s.state,
              }))
            }
          }
        } catch {
          // ignore — check-suites fetch is best-effort
        }
      }

      const pr: PrReviewDetail = {
        number: Number(meta.number),
        title: String(meta.title ?? ''),
        body: String(meta.body ?? ''),
        author: String((meta.author as Record<string, unknown>)?.login ?? ''),
        authorAvatarUrl: String((meta.author as Record<string, unknown>)?.avatarUrl ?? ''),
        openedAt: String(meta.createdAt ?? ''),
        headRefName: String(meta.headRefName ?? ''),
        baseRefName: String(meta.baseRefName ?? ''),
        headSHA: String(meta.headRefOid ?? ''),
        isDraft: Boolean(meta.isDraft),
        mergeStateStatus: mapMergeStateStatus(String(meta.mergeStateStatus ?? '')),
        ciStatus: mapCiStatus(rollup),
        lintStatus: mapCheckStatus(rollup, LINT_CHECK_NAMES),
        coverageStatus: mapCheckStatus(rollup, COVERAGE_CHECK_NAMES),
        statusChecks: mapStatusChecks(rollup),
        approvals: mapApprovals(reviewsData),
        requestedReviewers,
        assigneeLogins,
        chapters,
        issueRefs,
        dryViolations,
        readingOrder: [],
        movedBlocks: [],
        insights: null,
      }

      // Definitions-first order, moved code and insights (R3, S4, R4). Never throws.
      const analysis = await analysePr(filesData, {
        readingOrder: [],
        chapters,
        statusChecks: Array.isArray(rollup)
          ? (rollup as Array<Record<string, unknown>>).map((c) => ({
              name: String(c.name ?? c.context ?? ''),
              state: String(c.conclusion ?? c.state ?? ''),
              description: c.description ? String(c.description) : undefined,
            }))
          : [],
        dryViolations,
        localCoverage: null,
        findTestReferences: (symbols) => findTestReferencesInRepo(repoRoot, symbols, runGit),
      })
      pr.chapters = applyReadingOrder(chapters, analysis.readingOrder)
      pr.readingOrder = analysis.readingOrder
      pr.movedBlocks = analysis.movedBlocks
      pr.insights = analysis.insights
      return { pr }
    } catch (e) {
      return catchError(e)
    }
  })

  register('github:file-cochange', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      files: z.array(z.string()).min(1),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, files } = parsed.data
    if (parseRemoteRepo(repoRoot)) return { affinity: {} }
    try {
      const affinity = await computeCoChangeAffinityFromGit(repoRoot, files)
      return { affinity: Object.fromEntries(affinity) }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('github:pr-mark-ready', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), prNumber: z.number().int().positive() })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber } = parsed.data
    try {
      await gh(repoRoot, ['pr', 'ready', String(prNumber)])
      return { ok: true }
    } catch (e) {
      return catchError(e)
    }
  })

  register('github:pr-update-branch', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), prNumber: z.number().int().positive() })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber } = parsed.data
    try {
      await gh(repoRoot, ['pr', 'update-branch', String(prNumber), '--rebase=false'], 30_000)
      return { ok: true }
    } catch (e) {
      return catchError(e)
    }
  })

  register('github:pr-file-diff', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      prNumber: z.number().int().positive(),
      path: z.string().min(1),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber, path } = parsed.data
    try {
      // No checkout: GitHub's own per-file patch is the diff.
      if (parseRemoteRepo(repoRoot)) {
        const filesRaw = await gh(repoRoot, [
          'api',
          '--paginate',
          `repos/{owner}/{repo}/pulls/${prNumber}/files`,
          '--jq',
          '[.[] | {filename, patch}]',
        ])
        const files = JSON.parse(filesRaw) as Array<{ filename: string; patch?: string }>
        const file = files.find((f) => f.filename === path)
        return { diff: parseDiff(file?.patch ?? '', path) }
      }
      const prRef = `refs/remotes/pull/${prNumber}/head`
      await runGit(repoRoot, ['fetch', '--force', 'origin', `pull/${prNumber}/head:${prRef}`])

      const baseRefName = (
        await gh(repoRoot, [
          'pr',
          'view',
          String(prNumber),
          '--json',
          'baseRefName',
          '--jq',
          '.baseRefName',
        ])
      ).trim()

      const mergeBase = await runGit(repoRoot, ['merge-base', `origin/${baseRefName}`, prRef])

      const diffRaw = await runGit(repoRoot, ['diff', `${mergeBase.trim()}...${prRef}`, '--', path])
      const diff = parseDiff(diffRaw, path)
      return { diff }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('github:file-metrics', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), path: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, path } = parsed.data
    if (parseRemoteRepo(repoRoot)) {
      return {
        churn90d: 0,
        blastRadius: 0,
        topImporters: [],
        importerCount: 0,
        testFilePresent: false,
        patchCoverage: null,
      }
    }
    try {
      const isTestFile =
        /\.(spec|test)\.[^.]+$/.test(path) || // JS/TS: foo.spec.ts, foo.test.js
        /(?:^|\/)test_[^/]+$/.test(path) || // Python/Ruby: test_foo.py
        /_test\.[^.]+$/.test(path) || // Go/Python: foo_test.go, foo_test.py
        /_spec\.[^.]+$/.test(path) || // Ruby: foo_spec.rb
        /Tests?\.[^.]+$/.test(path) || // Java/Kotlin/C#: FooTest.java, FooTests.cs
        /Spec\.[^.]+$/.test(path) // JVM/C#: FooSpec.kt
      const stem = basename(path, `.${basename(path).split('.').pop()}`)
      // Match actual import/require/from statements only — not plain-text mentions in markdown or comments.
      // No extension allowlist: the pattern itself is the filter. Any language that uses import/require/from
      // syntax will be found; prose files (markdown, YAML, JSON, gitignore…) won't match.
      const importPattern = `(from|require|import).*['"./]` + stem + `['"/]`
      const [churnRaw, blastRaw, testRaw] = await Promise.all([
        runGit(repoRoot, ['log', '--oneline', '--since=90 days ago', '--', path]),
        runGit(repoRoot, ['grep', '-rl', '--extended-regexp', importPattern]).catch(() => ''),
        isTestFile
          ? Promise.resolve(null)
          : runGit(repoRoot, ['ls-files', '--', `**/${stem}*.spec.*`, `**/${stem}*.test.*`]).catch(
              () => ''
            ),
      ])
      const churn90d = churnRaw ? churnRaw.split('\n').filter(Boolean).length : 0
      const importerLines = blastRaw
        ? blastRaw
            .split('\n')
            .filter(Boolean)
            .filter((l) => l !== path)
        : []
      const blastRadius = importerLines.length
      const importerCount = importerLines.length
      const testFilePresent = isTestFile ? true : testRaw ? testRaw.trim().length > 0 : false
      const patchCoverage = await readFileCoverage(repoRoot, path)
      return {
        churn90d,
        blastRadius,
        topImporters: importerLines,
        importerCount,
        testFilePresent,
        patchCoverage,
      }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('github:pr-inline-comments', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), prNumber: z.number().int().positive() })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber } = parsed.data
    try {
      const raw = await gh(repoRoot, [
        'api',
        `repos/{owner}/{repo}/pulls/${prNumber}/comments`,
        '--paginate',
        '--jq',
        '[.[] | {id,user,body,created_at,updated_at,path,line,start_line,side,diff_hunk,in_reply_to_id,pull_request_review_id}]',
      ])
      const items = JSON.parse(raw) as unknown[]
      const comments: InlineComment[] = items.map(mapComment)

      // Resolved-thread state (R2). Best-effort: a GraphQL failure must not
      // fail the whole handler, since the REST comments above already loaded.
      let resolvedCommentIds: number[] = []
      try {
        const { owner, repo } = await ownerAndName(repoRoot)
        const gql =
          'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved comments(first:1){nodes{databaseId}}}}}}}'
        const threadsRaw = await gh(repoRoot, [
          'api',
          'graphql',
          '-f',
          `query=${gql}`,
          '-f',
          `o=${owner}`,
          '-f',
          `r=${repo}`,
          '-F',
          `n=${prNumber}`,
        ])
        const threadsData = JSON.parse(threadsRaw) as {
          data?: {
            repository?: {
              pullRequest?: {
                reviewThreads?: {
                  nodes?: Array<{
                    isResolved: boolean
                    comments: { nodes: Array<{ databaseId: number | null }> }
                  }>
                }
              }
            }
          }
        }
        const nodes = threadsData.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []
        resolvedCommentIds = nodes
          .filter((n) => n.isResolved)
          .map((n) => n.comments.nodes[0]?.databaseId)
          .filter((id): id is number => id != null)
      } catch {
        resolvedCommentIds = []
      }

      return { comments, resolvedCommentIds }
    } catch (e) {
      return catchError(e)
    }
  })

  register('github:pr-issue-comments', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), prNumber: z.number().int().positive() })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber } = parsed.data
    try {
      // Fetch issue comments and PR review bodies in parallel.
      // Review body comments (submitted via "Submit review" → COMMENT/APPROVE/REQUEST_CHANGES)
      // live at /pulls/{n}/reviews, not /issues/{n}/comments, so they must be merged separately.
      const [issueRaw, reviewsRaw] = await Promise.all([
        gh(repoRoot, [
          'api',
          `repos/{owner}/{repo}/issues/${prNumber}/comments`,
          '--paginate',
          '--jq',
          '[.[] | {id,user,body,created_at,updated_at}]',
        ]),
        gh(repoRoot, [
          'api',
          `repos/{owner}/{repo}/pulls/${prNumber}/reviews`,
          '--jq',
          '[.[] | select(.body != null and .body != "") | {id,user,body,submitted_at}]',
        ]).catch(() => '[]'),
      ])
      const issueItems = JSON.parse(issueRaw) as unknown[]
      const reviewItems = (JSON.parse(reviewsRaw) as unknown[]).map((r) => {
        const obj = r as Record<string, unknown>
        // Map review fields to the IssueComment shape (use submitted_at for both timestamps).
        return { ...obj, created_at: obj.submitted_at, updated_at: obj.submitted_at }
      })
      const comments: IssueComment[] = [...issueItems, ...reviewItems]
        .map(mapIssueComment)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      return { comments }
    } catch (e) {
      return catchError(e)
    }
  })

  register('github:pr-issue-comment-add', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      prNumber: z.number().int().positive(),
      body: z.string().min(1),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber, body } = parsed.data
    try {
      const raw = await gh(repoRoot, [
        'api',
        `repos/{owner}/{repo}/issues/${prNumber}/comments`,
        '--method',
        'POST',
        '--field',
        `body=${body}`,
      ])
      const comment = mapIssueComment(JSON.parse(raw))
      return { comment }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('github:pr-comment-add', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      prNumber: z.number().int().positive(),
      commitId: z.string().min(1),
      path: z.string().min(1),
      line: z.number().int().positive(),
      startLine: z.number().int().positive().optional(),
      side: z.enum(['LEFT', 'RIGHT']),
      body: z.string().min(1),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber, commitId, path, line, startLine, side, body } = parsed.data
    try {
      const args = [
        'api',
        `repos/{owner}/{repo}/pulls/${prNumber}/comments`,
        '--method',
        'POST',
        '--field',
        `commit_id=${commitId}`,
        '--field',
        `path=${path}`,
        '--field',
        `line=${line}`,
        '--field',
        `side=${side}`,
        '--field',
        `body=${body}`,
      ]
      if (startLine != null) {
        args.push('--field', `start_line=${startLine}`, '--field', `start_side=${side}`)
      }
      const raw = await gh(repoRoot, args)
      const comment = mapComment(JSON.parse(raw))
      return { comment }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('github:pr-comment-reply', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      prNumber: z.number().int().positive(),
      inReplyToId: z.number().int().positive(),
      body: z.string().min(1),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber, inReplyToId, body } = parsed.data
    try {
      const raw = await gh(repoRoot, [
        'api',
        `repos/{owner}/{repo}/pulls/${prNumber}/comments/${inReplyToId}/replies`,
        '--method',
        'POST',
        '--field',
        `body=${body}`,
      ])
      const comment = mapComment(JSON.parse(raw))
      return { comment }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('github:pr-review-submit', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      prNumber: z.number().int().positive(),
      event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
      body: z.string(),
      comments: z
        .array(
          z.object({
            path: z.string().min(1),
            line: z.number().int().positive(),
            startLine: z.number().int().positive().nullable().optional(),
            side: z.enum(['LEFT', 'RIGHT']),
            body: z.string().min(1),
          })
        )
        .optional(),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber, event, body, comments } = parsed.data
    try {
      const { owner, repo } = await ownerAndName(repoRoot)
      const endpoint = `repos/${owner}/${repo}/pulls/${prNumber}/reviews`

      // Draft comments (S5) go in the SAME POST as the review, via --input,
      // so they land as part of one review rather than separate REST calls.
      if (comments && comments.length > 0) {
        const requestBody: Record<string, unknown> = { event }
        if (body.trim()) requestBody.body = body
        requestBody.comments = comments.map((c) => {
          const entry: Record<string, unknown> = {
            path: c.path,
            line: c.line,
            side: c.side,
            body: c.body,
          }
          if (c.startLine != null && c.startLine !== c.line) {
            entry.start_line = c.startLine
            entry.start_side = c.side
          }
          return entry
        })
        const tmpFile = join(
          tmpdir(),
          `pr-review-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
        )
        await writeFile(tmpFile, JSON.stringify(requestBody))
        try {
          const raw = await gh(repoRoot, ['api', endpoint, '--method', 'POST', '--input', tmpFile])
          const data = JSON.parse(raw) as Record<string, unknown>
          return { reviewId: Number(data.id) }
        } finally {
          await unlink(tmpFile).catch(() => {})
        }
      }

      const args = ['api', endpoint, '--method', 'POST', '--raw-field', `event=${event}`]
      // Only include body if non-empty; GitHub rejects empty string body for some events.
      if (body.trim()) {
        args.push('--raw-field', `body=${body}`)
      }
      const raw = await gh(repoRoot, args)
      const data = JSON.parse(raw) as Record<string, unknown>
      return { reviewId: Number(data.id) }
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string; message?: string }
      // gh api writes the GitHub JSON error body to stdout on failure;
      // stderr only gets the short "gh: Unprocessable Entity (HTTP 422)" summary.
      // Check stdout first so we get the specific error message, not the opaque HTTP status.
      const ghOutput = (err.stdout ?? err.stderr ?? '').trim()
      const jsonMatch = ghOutput.match(/\{[\s\S]*?\}/)
      if (jsonMatch) {
        try {
          const apiErr = JSON.parse(jsonMatch[0]) as {
            message?: string
            errors?: Array<string | { message?: string }>
          }
          // Prefer the specific error item over the generic HTTP status message.
          const firstError = apiErr.errors?.[0]
          const specific =
            typeof firstError === 'string'
              ? firstError
              : typeof firstError === 'object'
                ? firstError.message
                : undefined
          const msg = specific ?? apiErr.message
          if (msg) return { error: msg }
        } catch {
          // ignore JSON parse failure
        }
      }
      if (ghOutput) return { error: ghOutput }
      return { error: String(e) }
    }
  })

  register('github:sessions-for-repo', (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { sessions: [] }
    const { repoRoot } = parsed.data
    const all = sessionStore.store
    const prefix = `${repoRoot}:::`
    // v2 keys are "repo:::pr"; v1 keys are "repo:::pr:::sha". When both exist
    // for the same PR, the new key wins — it's the one v2 code keeps current.
    const byPrNumber = new Map<number, { session: ReviewSession; isNewKey: boolean }>()
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(prefix)) continue
      const result = ReviewSessionSchema.safeParse(value)
      if (!result.success) continue
      const rest = key.slice(prefix.length)
      const isNewKey = !rest.includes(':::')
      const existing = byPrNumber.get(result.data.prNumber)
      if (!existing || (isNewKey && !existing.isNewKey)) {
        byPrNumber.set(result.data.prNumber, { session: result.data, isNewKey })
      }
    }
    return { sessions: Array.from(byPrNumber.values()).map((v) => v.session) }
  })

  register('github:session-get', (payload) => {
    const schema = z.object({ key: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { session: null }
    const raw = sessionStore.get(parsed.data.key)
    if (!raw) return { session: null }
    const result = ReviewSessionSchema.safeParse(raw)
    return result.success ? { session: result.data } : { session: null }
  })

  register('github:session-set', (payload) => {
    const schema = z.object({ key: z.string().min(1), session: z.unknown() })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const result = ReviewSessionSchema.safeParse(parsed.data.session)
    if (!result.success) return { error: 'VALIDATION_ERROR' }
    try {
      sessionStore.set(parsed.data.key, result.data)
      return { ok: true as const }
    } catch (e) {
      return { error: String(e) }
    }
  })

  // Persist a ReviewQueuePR snapshot so it appears in-progress on every load,
  // regardless of which page it falls on. Key: "<repoRoot>:<prNumber>".
  register('github:save-active-review', (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), pr: z.unknown() })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      const key = `${parsed.data.repoRoot}:${(parsed.data.pr as { number: number }).number}`
      activeReviewStore.set(key, { repoRoot: parsed.data.repoRoot, pr: parsed.data.pr })
      return { ok: true as const }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('github:active-reviews-for-repo', (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      const all = activeReviewStore.store
      const prs = Object.values(all)
        .filter(
          (entry): entry is { repoRoot: string; pr: unknown } =>
            typeof entry === 'object' &&
            entry !== null &&
            (entry as { repoRoot: string }).repoRoot === parsed.data.repoRoot
        )
        .map((entry) => entry.pr)
      return { prs }
    } catch (e) {
      return { error: String(e) }
    }
  })

  // Remove a single active-review entry (used when user dismisses an in-progress PR or
  // when a PR is confirmed closed/merged).
  register('github:remove-active-review', (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), prNumber: z.number().int().positive() })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      const { repoRoot, prNumber } = parsed.data
      activeReviewStore.delete(`${repoRoot}:${prNumber}`)
      // Also delete all session store entries for this PR so it won't re-appear as in-progress on next load
      const sessionPrefix = `${repoRoot}:::${prNumber}:::`
      for (const key of Object.keys(sessionStore.store)) {
        if (key.startsWith(sessionPrefix)) sessionStore.delete(key)
      }
      return { ok: true as const }
    } catch (e) {
      return { error: String(e) }
    }
  })

  // Check all supplied orphan PR numbers against GitHub and remove any that are
  // now CLOSED or MERGED from the active-review store.
  // Returns the subset of prNumbers that are still OPEN.
  register('github:prune-active-reviews', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      prNumbers: z.array(z.number().int().positive()),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumbers } = parsed.data
    if (prNumbers.length === 0) return { openNumbers: [] }
    try {
      const results = await Promise.allSettled(
        prNumbers.map(async (num) => {
          const raw = await gh(repoRoot, ['pr', 'view', String(num), '--json', 'number,state'])
          const data = JSON.parse(raw) as { number: number; state: string }
          return { number: data.number, state: data.state }
        })
      )
      const openNumbers: number[] = []
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const { number: num, state } = r.value
          if (state === 'OPEN') {
            openNumbers.push(num)
          } else {
            // PR is CLOSED or MERGED — clean up the persisted snapshot
            const key = `${repoRoot}:${num}`
            activeReviewStore.delete(key)
          }
        }
      }
      return { openNumbers }
    } catch (e) {
      return catchError(e)
    }
  })

  // ─── Review dashboard (R1) ─────────────────────────────────────────────────

  register('github:dashboard-search', async (payload) => {
    const schema = z.object({})
    const parsed = schema.safeParse(payload ?? {})
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      const cwd = homedir()
      const login = (await gh(cwd, ['api', 'user', '--jq', '.login'])).trim()
      const query = buildDashboardQuery(login)
      const raw = await gh(cwd, ['api', 'graphql', '-f', `query=${query}`], 60_000)
      const data = JSON.parse(raw)

      const localRoots = new Map<string, string>()
      if (listProjectRoots) {
        const roots = listProjectRoots()
        await Promise.all(
          roots.map(async (root) => {
            try {
              const url = await runGit(root, ['remote', 'get-url', 'origin'])
              const parsed = parseGitRemoteUrl(url)
              if (parsed) localRoots.set(`${parsed.owner}/${parsed.name}`, root)
            } catch {
              // no origin remote / not a git repo — skip
            }
          })
        )
      }

      const prs = parseDashboard(data, login, localRoots)
      return { prs, login, fetchedAt: new Date().toISOString() }
    } catch (e) {
      return catchError(e)
    }
  })

  // ─── Viewed-file sync (S1) ──────────────────────────────────────────────────

  register('github:file-viewed-set', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      prNumber: z.number().int().positive(),
      path: z.string().min(1),
      viewed: z.boolean(),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber, path, viewed } = parsed.data
    try {
      const { owner, repo } = await ownerAndName(repoRoot)
      const idRaw = await gh(repoRoot, [
        'api',
        'graphql',
        '-f',
        'query=query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){id}}}',
        '-f',
        `o=${owner}`,
        '-f',
        `r=${repo}`,
        '-F',
        `n=${prNumber}`,
      ])
      const idData = JSON.parse(idRaw) as {
        data: { repository: { pullRequest: { id: string } } }
      }
      const pullRequestId = idData.data.repository.pullRequest.id
      const mutationName = viewed ? 'markFileAsViewed' : 'unmarkFileAsViewed'
      const gql = `mutation($id:ID!,$p:String!){${mutationName}(input:{pullRequestId:$id,path:$p}){clientMutationId}}`
      await gh(repoRoot, [
        'api',
        'graphql',
        '-f',
        `query=${gql}`,
        '-f',
        `id=${pullRequestId}`,
        '-f',
        `p=${path}`,
      ])
      return { ok: true }
    } catch (e) {
      return catchError(e)
    }
  })

  // ─── Historical diff compare (S1) ──────────────────────────────────────────

  register('github:pr-compare', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      fromSha: z.string().min(1),
      toSha: z.string().min(1),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, fromSha, toSha } = parsed.data
    try {
      const { owner, repo } = await ownerAndName(repoRoot)
      const raw = await gh(repoRoot, [
        'api',
        `repos/${owner}/${repo}/compare/${fromSha}...${toSha}`,
      ])
      const data = JSON.parse(raw) as {
        ahead_by?: number
        files?: Array<{ filename: string; status: string; patch?: string }>
      }
      const files = (data.files ?? []).map((f) => ({
        path: f.filename,
        status: f.status,
        patch: f.patch ?? '',
      }))
      return { rewritten: false, commits: data.ahead_by ?? 0, files }
    } catch (e) {
      const msg = String(e)
      if (msg.includes('404') || msg.includes('No common ancestor') || msg.includes('Not Found')) {
        return { rewritten: true, commits: 0, files: [] }
      }
      return catchError(e)
    }
  })

  register('github:tests-for-block', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      headSHA: z.string().min(1),
      path: z.string().min(1),
      code: z.string(),
      hunkHeader: z.string().optional(),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, headSHA, path, code, hunkHeader } = parsed.data
    const symbols = await symbolsForBlock(path, code, hunkHeader)
    const locations = await findTestLocations(repoRoot, headSHA, symbols, runGit)
    return { symbols, locations }
  })

  // ─── Clone for diff-only review (uncloned PRs) ─────────────────────────────

  register('github:clone-repo', async (payload) => {
    const schema = z.object({ repo: z.string().min(1), folder: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repo, folder } = parsed.data
    if (!existsSync(folder)) return { error: 'FOLDER_NOT_FOUND' }
    try {
      const name = repo.split('/')[1] ?? repo
      await gh(folder, ['repo', 'clone', repo, name])
      return { repoRoot: join(folder, name) }
    } catch (e) {
      return catchError(e)
    }
  })
}

// A remote URL is either https (https://github.com/owner/name(.git)) or ssh
// (git@github.com:owner/name.git) — both map to the same "owner/name" key
// dashboard-search uses to find a PR's local checkout.
function parseGitRemoteUrl(url: string): { owner: string; name: string } | null {
  const trimmed = url.trim()
  const httpsMatch = trimmed.match(/github\.com\/([^/]+)\/([^/]+?)(\.git)?\/?$/)
  if (httpsMatch) return { owner: httpsMatch[1], name: httpsMatch[2] }
  const sshMatch = trimmed.match(/github\.com:([^/]+)\/([^/]+?)(\.git)?\/?$/)
  if (sshMatch) return { owner: sshMatch[1], name: sshMatch[2] }
  return null
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function readFileCoverage(repoRoot: string, filePath: string): Promise<number | null> {
  // Try Istanbul/nyc coverage-summary.json first
  try {
    const summaryPath = join(repoRoot, 'coverage', 'coverage-summary.json')
    const raw = await readFile(summaryPath, 'utf-8')
    const summary = JSON.parse(raw) as Record<string, { lines?: { pct?: number } }>
    // Keys use absolute or relative paths — try both
    const candidates = [filePath, join(repoRoot, filePath), `./${filePath}`]
    for (const key of candidates) {
      if (summary[key]?.lines?.pct != null) return Math.round(summary[key].lines!.pct!)
    }
    // Partial match: key ends with filePath
    const match = Object.entries(summary).find(([k]) => k.endsWith(filePath))
    if (match) return Math.round(match[1]?.lines?.pct ?? 0)
  } catch {
    /* file not found or parse error — fall through */
  }

  // Try lcov.info
  try {
    const lcovPath = join(repoRoot, 'coverage', 'lcov.info')
    const raw = await readFile(lcovPath, 'utf-8')
    const sections = raw.split('end_of_record')
    for (const section of sections) {
      if (!section.includes(filePath)) continue
      const linesFound = Number(section.match(/LF:(\d+)/)?.[1] ?? '0')
      const linesHit = Number(section.match(/LH:(\d+)/)?.[1] ?? '0')
      if (linesFound > 0) return Math.round((linesHit / linesFound) * 100)
    }
  } catch {
    /* file not found or parse error */
  }

  return null
}
