import { z } from 'zod'
import { namedStore } from '../storage-directory.js'
import { basename, join } from 'path'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { homedir } from 'os'
import type {
  ReviewQueuePR,
  PrReviewDetail,
  InlineComment,
  IssueComment,
  ReviewSession,
  DashboardSection,
} from '../schemas/pr-review.schema.js'
import { ReviewQueuePRSchema, ReviewSessionSchema } from '../schemas/pr-review.schema.js'
import { buildSectionQueries, parseDashboard } from '../github/dashboard-search.js'
import {
  dashboardBranches,
  resolveBranchExclusions,
  type BranchExclusionQuery,
} from '../github/dashboard-search.js'
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
import type { GithubApiRequest, GithubTarget } from '@terminator/extension-sdk'
import { runGit, exceededMaxBuffer, type GitRunOptions } from '../shell/run-git.js'
import {
  type GithubAccess,
  isAuthError,
  getRepoOwnerAndName,
  PR_JSON_FIELDS,
  stateForSearch,
  computeCoChangeAffinityFromGit,
} from '../github/gh-cli.js'
import { defineChannel, noPayload } from '@terminator/extension-sdk'
import { RepoRoot, parseRemoteRepo } from './repo-root.js'
import { withTiming, VALIDATION_ERROR, errorEnvelope, type RegisterFn } from './register.js'
import { analysePr } from '../review/analyse.js'
import { applyReadingOrder } from '../review/apply-reading-order.js'
import { findTestReferencesInRepo } from '../review/test-references.js'
import { findTestLocations, symbolsForBlock } from '../review/test-locations.js'

const sessionStore = () => namedStore('pr-review-sessions')
const activeReviewStore = () => namedStore('pr-active-reviews')

/** Files past this size are not sent to the renderer for context expansion. */
const MAX_FILE_CONTENT_BYTES = 2 * 1024 * 1024
// One byte over the limit, so an oversized file overflows the buffer instead of being read whole.
const FILE_CONTENT_OUTPUT: GitRunOptions = { raw: true, maxBuffer: MAX_FILE_CONTENT_BYTES + 1 }
const isOverflow = (e: unknown) =>
  exceededMaxBuffer(e) || (e as { exceededMaxBuffer?: boolean } | null)?.exceededMaxBuffer === true

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

// ─── Registration ─────────────────────────────────────────────────────────────

/** The application's tracker connection, when this build's host offers one. */
type IssuesApi = Parameters<typeof enrichIssueRefs>[1]

/** Where gh runs for a repoRoot: the checkout, or the home directory and GH_REPO. */
function githubTarget(repoRoot: string, token: string): GithubTarget {
  const remote = parseRemoteRepo(repoRoot)
  const as = token ? { token } : {}
  if (remote) return { cwd: homedir(), repository: `${remote.owner}/${remote.name}`, ...as }
  return { cwd: repoRoot, ...as }
}

interface AccessibleRepo {
  fullName: string
  owner: string
  private: boolean
  pushedAt: string
}

function parseAccessibleRepos(jsonLines: string): AccessibleRepo[] {
  return jsonLines
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as AccessibleRepo & { archived: boolean })
    .filter((repo) => !repo.archived)
    .map(({ fullName, owner, private: isPrivate, pushedAt }) => ({
      fullName,
      owner,
      private: isPrivate,
      pushedAt,
    }))
    .sort((a, b) => a.fullName.toLowerCase().localeCompare(b.fullName.toLowerCase()))
}

const RepoRootPayload = z.object({ repoRoot: RepoRoot })

/** Payload of a channel that acts on one pull request of a checkout. */
const PullRequestPayload = RepoRootPayload.extend({ prNumber: z.number().int().positive() })

/** GitHub's own reason a review was refused, else gh's output, else the error. */
function reviewSubmitError(e: unknown): { error: string } {
  const err = e as { stderr?: string; stdout?: string; message?: string }
  // gh api writes the GitHub JSON error body to stdout on failure;
  // stderr only gets the short "gh: Unprocessable Entity (HTTP 422)" summary.
  // Check stdout first so we get the specific error message, not the opaque HTTP status.
  const ghOutput = (err.stdout || err.stderr || '').trim()
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
  return { error: ghOutput || String(e) }
}

/** The last line of a gh failure, e.g. "gh: HTTP 502"; the first lines echo the whole command. */
function lastLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const lines = text.split('\n').filter((line) => line.trim())
  return (lines.at(-1) ?? text).trim()
}

export function registerGithubHandlers(
  registerRaw: RegisterFn,
  access: GithubAccess,
  issues?: IssuesApi,
  listProjectRoots?: () => string[],
  getReviewRepos?: () => string[],
  isBranchExcluded: BranchExclusionQuery = async () => false
): void {
  const register = withTiming(registerRaw)
  const excludedIn = (prs: ReadonlyArray<{ headRefName: string }>, repoPath: string) =>
    resolveBranchExclusions(
      isBranchExcluded,
      prs.map((pr) => ({ branch: pr.headRefName, repoPath }))
    )
  const { github } = access
  const target = (repoRoot: string) => githubTarget(repoRoot, access.getToken())
  const api = (repoRoot: string, request: GithubApiRequest) => github.api(target(repoRoot), request)
  // `gh repo view` costs 0.4-0.7 s, so the answer is kept for the life of the process.
  const ownerAndNameCache = new Map<string, Promise<{ owner: string; repo: string }>>()
  const ownerAndName = (repoRoot: string) => {
    const remote = parseRemoteRepo(repoRoot)
    if (remote) return Promise.resolve({ owner: remote.owner, repo: remote.name })
    const cached = ownerAndNameCache.get(repoRoot)
    if (cached) return cached
    const lookup = getRepoOwnerAndName(target(repoRoot), github)
    ownerAndNameCache.set(repoRoot, lookup)
    lookup.catch(() => ownerAndNameCache.delete(repoRoot))
    return lookup
  }
  let viewerLogin: Promise<string> | undefined
  const viewer = (cwd: string) => {
    if (viewerLogin) return viewerLogin
    const lookup = api(cwd, { path: 'user', jq: '.login' }).then((raw) => raw.trim())
    viewerLogin = lookup
    lookup.catch(() => {
      if (viewerLogin === lookup) viewerLogin = undefined
    })
    return lookup
  }
  // Per pull request: the head commit the local pull ref was last fetched at, and its merge base.
  const prDiffBases = new Map<string, { headSHA: string; mergeBase: string }>()
  const catchError = (e: unknown) => {
    if (isAuthError(e)) return { error: 'NOT_AUTHENTICATED' as const }
    const msg = String(e)
    if (msg.includes('rate limit') || msg.includes('API rate limit')) {
      return { error: 'RATE_LIMITED' as const, resetAt: Date.now() + 60_000 }
    }
    return { error: msg }
  }

  register(
    defineChannel({
      channel: 'github:current-user',
      schema: RepoRootPayload,
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot }) => {
        return { login: await viewer(repoRoot) }
      },
      onError: errorEnvelope,
    })
  )

  register(
    defineChannel({
      channel: 'github:list-open-prs',
      schema: z.object({
        repoRoot: RepoRoot,
        cursor: z.string().optional(),
        search: z.string().optional(),
      }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, cursor, search }) => {
        // PR number lookup — always finds the PR regardless of state
        if (search && /^\d+$/.test(search.trim())) {
          const view = await github.pullRequests.view(
            target(repoRoot),
            search.trim(),
            PR_JSON_FIELDS
          )
          const pr = parseReviewQueuePR(view)
          return { prs: [pr], totalCount: 1, hasMore: false }
        }

        // Text search — open PRs unless an is:merged / is:closed / is:all qualifier says otherwise
        if (search && search.trim()) {
          const { state, text } = stateForSearch(search)
          const found = await github.pullRequests.list(target(repoRoot), {
            state,
            ...(text ? { search: text } : {}),
            limit: 50,
            fields: PR_JSON_FIELDS,
          })
          const parsed = found.map(parseReviewQueuePR)
          const excluded = await excludedIn(parsed, repoRoot)
          const prs: ReviewQueuePR[] = parsed.filter((pr) => !excluded(pr.headRefName, repoRoot))
          return { prs, totalCount: prs.length, hasMore: false }
        }

        // Paginated load via GraphQL
        const { owner, repo } = await ownerAndName(repoRoot)
        const gql = `query($owner:String!,$repo:String!,$cursor:String){repository(owner:$owner,name:$repo){pullRequests(first:20,states:OPEN,after:$cursor,orderBy:{field:CREATED_AT,direction:DESC}){totalCount pageInfo{endCursor hasNextPage}nodes{number title state isDraft additions deletions createdAt headRefName baseRefName changedFiles mergeStateStatus author{login avatarUrl}assignees(first:10){nodes{login}}latestReviews(first:20){nodes{author{login avatarUrl}state submittedAt}}reviewRequests(first:10){nodes{requestedReviewer{...on User{login avatarUrl}...on Team{name}}}}commits(last:1){nodes{commit{statusCheckRollup{contexts(first:20){nodes{...on CheckRun{name conclusion status}...on StatusContext{context state}}}}}}}}}}}`
        const raw = await api(repoRoot, {
          path: 'graphql',
          fields: { query: gql, owner, repo, ...(cursor ? { cursor } : {}) },
          timeoutMs: 60_000,
        })
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
        const page = nodes.map((n) => parseReviewQueuePR(normalizeGraphQLNode(n)))
        const excluded = await excludedIn(page, repoRoot)
        const prs = page.filter((pr) => !excluded(pr.headRefName, repoRoot))
        return {
          prs,
          // The count the summary line reports. Without it the view can only
          // count the rows it happens to hold, which is the page size — so a
          // repository with 47 open PRs said "20 waiting on you". Excluded
          // branches are only known page by page, so this page's are taken off.
          totalCount: totalCount - (page.length - prs.length),
          hasMore: pageInfo.hasNextPage,
          nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : undefined,
        }
      },
      onError: catchError,
    })
  )

  register(
    defineChannel({
      channel: 'github:pr-review-detail',
      schema: PullRequestPayload,
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, prNumber }) => {
        const { owner, repo } = await ownerAndName(repoRoot)
        const pull = `repos/${owner}/${repo}/pulls/${prNumber}`
        const [meta, filesRaw, reviewsRaw, reviewersRaw] = await Promise.all([
          github.pullRequests.view(target(repoRoot), prNumber, PR_DETAIL_FIELDS),
          // Use REST API to get file list with patch content for import-graph grouping
          api(repoRoot, { path: `${pull}/files`, paginate: true }),
          api(repoRoot, { path: `${pull}/reviews` }).catch(() => '[]'),
          api(repoRoot, { path: `${pull}/requested_reviewers` }).catch(
            () => '{"users":[],"teams":[]}'
          ),
        ])
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
        const assigneeLogins = (
          (meta.assignees as Array<Record<string, unknown>> | undefined) ?? []
        )
          .map((a) => String(a.login ?? ''))
          .filter(Boolean)

        // Compute co-change affinity for universal chapter grouping (language-agnostic Signal 3)
        const filePaths = filesData.map((f) =>
          String(
            (f as Record<string, unknown>).filename ?? (f as Record<string, unknown>).path ?? ''
          )
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
              const suitesRaw = await api(repoRoot, {
                path: `repos/${owner}/${repo}/commits/${headSHA}/check-suites`,
                jq: '[.check_suites[] | {name: .app.name, state: .status, conclusion}]',
              })
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
          nodeId: typeof meta.id === 'string' ? meta.id : undefined,
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
      },
      onError: catchError,
    })
  )

  register(
    defineChannel({
      channel: 'github:pr-create',
      schema: z.object({
        repoRoot: RepoRoot,
        title: z.string().min(1),
        body: z.string(),
        base: z.string().min(1),
        head: z.string().min(1),
        draft: z.boolean(),
      }),
      invalid: VALIDATION_ERROR,
      run: ({ repoRoot, ...pullRequest }) =>
        github.pullRequests.create(target(repoRoot), pullRequest),
      onError: (e) => ({ error: e instanceof Error ? e.message : String(e) }),
    })
  )

  register(
    defineChannel({
      channel: 'github:pr-mark-ready',
      schema: PullRequestPayload,
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, prNumber }) => {
        await github.pullRequests.markReady(target(repoRoot), prNumber)
        return { ok: true }
      },
      onError: catchError,
    })
  )

  register(
    defineChannel({
      channel: 'github:pr-update-branch',
      schema: PullRequestPayload,
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, prNumber }) => {
        await github.pullRequests.updateBranch(target(repoRoot), prNumber)
        return { ok: true }
      },
      onError: catchError,
    })
  )

  register(
    defineChannel({
      channel: 'github:pr-file-diff',
      schema: z.object({
        repoRoot: RepoRoot,
        prNumber: z.number().int().positive(),
        path: z.string().min(1),
        baseRef: z.string().min(1).optional(),
        headSHA: z.string().min(1).optional(),
      }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, prNumber, path, baseRef, headSHA }) => {
        // No checkout: GitHub's own per-file patch is the diff.
        if (parseRemoteRepo(repoRoot)) {
          const filesRaw = await api(repoRoot, {
            path: `repos/{owner}/{repo}/pulls/${prNumber}/files`,
            paginate: true,
            jq: '[.[] | {filename, patch}]',
          })
          const files = JSON.parse(filesRaw) as Array<{ filename: string; patch?: string }>
          const file = files.find((f) => f.filename === path)
          return { diff: parseDiff(file?.patch ?? '', path) }
        }
        const prRef = `refs/remotes/pull/${prNumber}/head`
        const cacheKey = `${repoRoot}#${prNumber}`
        let mergeBase =
          headSHA && prDiffBases.get(cacheKey)?.headSHA === headSHA
            ? prDiffBases.get(cacheKey)!.mergeBase
            : undefined
        if (!mergeBase) {
          await runGit(repoRoot, ['fetch', '--force', 'origin', `pull/${prNumber}/head:${prRef}`])
          const baseRefName =
            baseRef ??
            String(
              (await github.pullRequests.view(target(repoRoot), prNumber, ['baseRefName']))
                .baseRefName
            )
          mergeBase = (
            await runGit(repoRoot, ['merge-base', `origin/${baseRefName}`, prRef])
          ).trim()
          if (headSHA) prDiffBases.set(cacheKey, { headSHA, mergeBase })
        }

        const diffRaw = await runGit(repoRoot, ['diff', `${mergeBase}...${prRef}`, '--', path])
        const diff = parseDiff(diffRaw, path)
        return { diff }
      },
      onError: errorEnvelope,
    })
  )

  register(
    defineChannel({
      channel: 'github:pr-file-content',
      schema: z.object({
        repoRoot: RepoRoot,
        prNumber: z.number().int().positive(),
        path: z.string().min(1),
        ref: z.string().min(1),
      }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, prNumber, path, ref }) => {
        let content: string
        const remote = parseRemoteRepo(repoRoot)
        if (remote) {
          const encodedPath = path.split('/').map(encodeURIComponent).join('/')
          content = await api(repoRoot, {
            path: `repos/{owner}/{repo}/contents/${encodedPath}?ref=${ref}`,
            accept: 'application/vnd.github.raw+json',
            maxBuffer: FILE_CONTENT_OUTPUT.maxBuffer,
          })
        } else {
          try {
            content = await runGit(repoRoot, ['show', `${ref}:${path}`], FILE_CONTENT_OUTPUT)
          } catch (e) {
            if (isOverflow(e)) throw e
            // The PR head may not be in the local object store yet.
            await runGit(repoRoot, [
              'fetch',
              '--force',
              'origin',
              `pull/${prNumber}/head:refs/remotes/pull/${prNumber}/head`,
            ])
            content = await runGit(repoRoot, ['show', `${ref}:${path}`], FILE_CONTENT_OUTPUT)
          }
        }
        if (Buffer.byteLength(content) > MAX_FILE_CONTENT_BYTES) return { tooLarge: true }
        return { content }
      },
      onError: (e) => (isOverflow(e) ? { tooLarge: true } : errorEnvelope(e)),
    })
  )

  // Metrics for every path from three git processes in total, not three per path.
  register(
    defineChannel({
      channel: 'github:files-metrics',
      schema: z.object({ repoRoot: RepoRoot, paths: z.array(z.string().min(1)) }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, paths }) => {
        const metrics: Record<string, FileMetrics> = {}
        if (parseRemoteRepo(repoRoot)) {
          for (const path of paths) metrics[path] = REMOTE_FILE_METRICS
          return { metrics }
        }
        const wanted = new Set(paths)
        const nonTests = paths.filter((p) => !isTestPath(p))
        const [churnRaw, importersByPath, testFiles] = await Promise.all([
          runGit(
            repoRoot,
            [
              '-c',
              'core.quotepath=false',
              'log',
              '--no-renames',
              '--name-only',
              '--format=%H',
              '--since=90 days ago',
            ],
            { maxBuffer: BATCH_MAX_BUFFER }
          ),
          importersFor(repoRoot, paths),
          nonTests.length > 0
            ? runGit(repoRoot, ['ls-files', '--', '**/*.spec.*', '**/*.test.*'], {
                maxBuffer: BATCH_MAX_BUFFER,
              }).catch(() => '')
            : Promise.resolve(''),
        ])
        const churn = new Map<string, number>()
        for (const line of churnRaw.split('\n')) {
          const file = line.trim()
          if (file && !/^[0-9a-f]{40}$/.test(file) && wanted.has(file)) {
            churn.set(file, (churn.get(file) ?? 0) + 1)
          }
        }
        const testList = testFiles.split('\n').filter(Boolean)
        const coverage = coverageReader(repoRoot)
        for (const path of paths) {
          const importerLines = importersByPath.get(path) ?? []
          metrics[path] = {
            churn90d: churn.get(path) ?? 0,
            blastRadius: importerLines.length,
            topImporters: importerLines,
            importerCount: importerLines.length,
            testFilePresent: isTestPath(path) ? true : hasTestFile(testList, path),
            patchCoverage: await coverage(path),
          }
        }
        return { metrics }
      },
      onError: errorEnvelope,
    })
  )

  register(
    defineChannel({
      channel: 'github:pr-inline-comments',
      schema: PullRequestPayload,
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, prNumber }) => {
        const raw = await api(repoRoot, {
          path: `repos/{owner}/{repo}/pulls/${prNumber}/comments`,
          paginate: true,
          jq: '[.[] | {id,user,body,created_at,updated_at,path,line,start_line,side,diff_hunk,in_reply_to_id,pull_request_review_id}]',
        })
        const items = JSON.parse(raw) as unknown[]
        const comments: InlineComment[] = items.map(mapComment)

        // Resolved-thread state (R2). Best-effort: a GraphQL failure must not
        // fail the whole handler, since the REST comments above already loaded.
        let resolvedCommentIds: number[]
        try {
          const { owner, repo } = await ownerAndName(repoRoot)
          const gql =
            'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved comments(first:1){nodes{databaseId}}}}}}}'
          const threadsRaw = await api(repoRoot, {
            path: 'graphql',
            fields: { query: gql, o: owner, r: repo },
            typedFields: { n: prNumber },
          })
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
      },
      onError: catchError,
    })
  )

  register(
    defineChannel({
      channel: 'github:pr-issue-comments',
      schema: PullRequestPayload,
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, prNumber }) => {
        // Fetch issue comments and PR review bodies in parallel.
        // Review body comments (submitted via "Submit review" → COMMENT/APPROVE/REQUEST_CHANGES)
        // live at /pulls/{n}/reviews, not /issues/{n}/comments, so they must be merged separately.
        const [issueRaw, reviewsRaw] = await Promise.all([
          api(repoRoot, {
            path: `repos/{owner}/{repo}/issues/${prNumber}/comments`,
            paginate: true,
            jq: '[.[] | {id,user,body,created_at,updated_at}]',
          }),
          api(repoRoot, {
            path: `repos/{owner}/{repo}/pulls/${prNumber}/reviews`,
            jq: '[.[] | select(.body != null and .body != "") | {id,user,body,submitted_at}]',
          }).catch(() => '[]'),
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
      },
      onError: catchError,
    })
  )

  register(
    defineChannel({
      channel: 'github:pr-issue-comment-add',
      schema: z.object({
        repoRoot: RepoRoot,
        prNumber: z.number().int().positive(),
        body: z.string().min(1),
      }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, prNumber, body }) => {
        const raw = await api(repoRoot, {
          path: `repos/{owner}/{repo}/issues/${prNumber}/comments`,
          method: 'POST',
          fields: { body },
        })
        const comment = mapIssueComment(JSON.parse(raw))
        return { comment }
      },
      onError: errorEnvelope,
    })
  )

  register(
    defineChannel({
      channel: 'github:pr-comment-reply',
      schema: z.object({
        repoRoot: RepoRoot,
        prNumber: z.number().int().positive(),
        inReplyToId: z.number().int().positive(),
        body: z.string().min(1),
      }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, prNumber, inReplyToId, body }) => {
        const raw = await api(repoRoot, {
          path: `repos/{owner}/{repo}/pulls/${prNumber}/comments/${inReplyToId}/replies`,
          method: 'POST',
          fields: { body },
        })
        const comment = mapComment(JSON.parse(raw))
        return { comment }
      },
      onError: errorEnvelope,
    })
  )

  register(
    defineChannel({
      channel: 'github:pr-review-submit',
      schema: z.object({
        repoRoot: RepoRoot,
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
      }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, prNumber, event, body, comments }) => {
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
          const raw = await api(repoRoot, { path: endpoint, method: 'POST', body: requestBody })
          const data = JSON.parse(raw) as Record<string, unknown>
          return { reviewId: Number(data.id) }
        }

        // Only include body if non-empty; GitHub rejects empty string body for some events.
        const fields: Record<string, string> = body.trim() ? { event, body } : { event }
        const raw = await api(repoRoot, { path: endpoint, method: 'POST', fields })
        const data = JSON.parse(raw) as Record<string, unknown>
        return { reviewId: Number(data.id) }
      },
      onError: reviewSubmitError,
    })
  )

  register(
    defineChannel({
      channel: 'github:sessions-for-repo',
      schema: RepoRootPayload,
      invalid: { sessions: [] },
      run: ({ repoRoot }) => ({ sessions: sessionsForRepo(repoRoot) }),
    })
  )

  register(
    defineChannel({
      channel: 'github:session-get',
      schema: z.object({ key: z.string().min(1) }),
      invalid: { session: null },
      run: ({ key }) => {
        const raw = sessionStore().get(key)
        if (!raw) return { session: null }
        const result = ReviewSessionSchema.safeParse(raw)
        return result.success ? { session: result.data } : { session: null }
      },
    })
  )

  register(
    defineChannel({
      channel: 'github:session-set',
      schema: z.object({ key: z.string().min(1), session: ReviewSessionSchema }),
      invalid: VALIDATION_ERROR,
      run: ({ key, session }) => {
        sessionStore().set(key, session)
        return { ok: true as const }
      },
      onError: errorEnvelope,
    })
  )

  // Persist a ReviewQueuePR snapshot so it appears in-progress on every load,
  // regardless of which page it falls on. Key: "<repoRoot>:<prNumber>".
  register(
    defineChannel({
      channel: 'github:save-active-review',
      schema: z.object({ repoRoot: RepoRoot, pr: ReviewQueuePRSchema }),
      invalid: VALIDATION_ERROR,
      run: ({ repoRoot, pr }) => {
        const key = `${repoRoot}:${pr.number}`
        activeReviewStore().set(key, { repoRoot, pr })
        return { ok: true as const }
      },
      onError: errorEnvelope,
    })
  )

  register(
    defineChannel({
      channel: 'github:active-reviews-for-repo',
      schema: RepoRootPayload,
      invalid: VALIDATION_ERROR,
      run: ({ repoRoot }) => {
        const all = activeReviewStore().store
        const prs = Object.values(all)
          .filter(
            (entry): entry is { repoRoot: string; pr: unknown } =>
              typeof entry === 'object' &&
              entry !== null &&
              (entry as { repoRoot: string }).repoRoot === repoRoot
          )
          .map((entry) => entry.pr)
        return { prs }
      },
      onError: errorEnvelope,
    })
  )

  // Remove a single active-review entry (used when user dismisses an in-progress PR or
  // when a PR is confirmed closed/merged).
  register(
    defineChannel({
      channel: 'github:remove-active-review',
      schema: PullRequestPayload,
      invalid: VALIDATION_ERROR,
      run: ({ repoRoot, prNumber }) => {
        activeReviewStore().delete(`${repoRoot}:${prNumber}`)
        // Also delete all session store entries for this PR so it won't re-appear as in-progress on next load
        const sessionPrefix = `${repoRoot}:::${prNumber}:::`
        for (const key of Object.keys(sessionStore().store)) {
          if (key.startsWith(sessionPrefix)) sessionStore().delete(key)
        }
        return { ok: true as const }
      },
      onError: errorEnvelope,
    })
  )

  // Check all supplied orphan PR numbers against GitHub and remove any that are
  // now CLOSED or MERGED from the active-review store.
  // Returns the subset of prNumbers that are still OPEN.
  register(
    defineChannel({
      channel: 'github:prune-active-reviews',
      schema: z.object({
        repoRoot: RepoRoot,
        prNumbers: z.array(z.number().int().positive()),
      }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, prNumbers }) => {
        if (prNumbers.length === 0) return { openNumbers: [] }
        const results = await Promise.allSettled(
          prNumbers.map(async (num) => {
            const data = await github.pullRequests.view(target(repoRoot), num, ['number', 'state'])
            return { number: Number(data.number), state: String(data.state) }
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
              activeReviewStore().delete(key)
            }
          }
        }
        return { openNumbers }
      },
      onError: catchError,
    })
  )

  // ─── Review dashboard (R1) ─────────────────────────────────────────────────

  // One `gh api --paginate` over every repository the viewer can reach; kept until a refresh.
  let accessibleRepos: Promise<AccessibleRepo[]> | undefined
  register(
    defineChannel({
      channel: 'github:accessible-repos',
      schema: z.object({ refresh: z.boolean().optional() }).optional(),
      invalid: VALIDATION_ERROR,
      run: async (args) => {
        if (args?.refresh || !accessibleRepos) {
          const lookup = api(homedir(), {
            path: 'user/repos?affiliation=owner,collaborator,organization_member&per_page=100',
            paginate: true,
            jq: '.[] | {fullName: .full_name, owner: .owner.login, private: .private, archived: .archived, pushedAt: .pushed_at}',
            timeoutMs: 60_000,
            maxBuffer: 50 * 1024 * 1024,
          }).then(parseAccessibleRepos)
          accessibleRepos = lookup
          lookup.catch(() => {
            if (accessibleRepos === lookup) accessibleRepos = undefined
          })
        }
        return { repos: await accessibleRepos }
      },
      onError: catchError,
    })
  )

  register(
    defineChannel({
      channel: 'github:dashboard-search',
      schema: noPayload,
      invalid: VALIDATION_ERROR,
      run: async () => {
        const cwd = homedir()
        const login = await viewer(cwd)
        const repos = getReviewRepos?.() ?? []
        const requests = buildSectionQueries(login, repos)
        const settled = await Promise.allSettled(
          requests.map(async ({ query }) => {
            const raw = await api(cwd, { path: 'graphql', fields: { query }, timeoutMs: 60_000 })
            return (
              (
                JSON.parse(raw) as {
                  data?: Record<string, { issueCount?: number; nodes?: unknown[] }>
                }
              ).data ?? {}
            )
          })
        )
        const failed = new Map<DashboardSection, string>()
        const merged: Record<string, { nodes: unknown[] }> = {}
        // A section is capped when GitHub matched more PRs than the first-50 page returned.
        const matched = new Map<DashboardSection, { issueCount: number; returned: number }>()
        let firstFailure: unknown
        settled.forEach((outcome, i) => {
          if (outcome.status === 'rejected') {
            firstFailure ??= outcome.reason
            failed.set(requests[i].section, lastLine(outcome.reason))
            return
          }
          for (const [alias, result] of Object.entries(outcome.value)) {
            merged[alias] ??= { nodes: [] }
            merged[alias].nodes.push(...(result?.nodes ?? []))
            const section = requests[i].section
            const prior = matched.get(section) ?? { issueCount: 0, returned: 0 }
            matched.set(section, {
              issueCount: prior.issueCount + (result?.issueCount ?? 0),
              returned: prior.returned + (result?.nodes?.length ?? 0),
            })
          }
        })
        if (failed.size === new Set(requests.map((r) => r.section)).size) {
          return catchError(firstFailure)
        }
        const data = { data: merged }

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

        const sessionsByRoot = new Map<string, Map<number, ReviewSession>>()
        const excluded = await resolveBranchExclusions(
          isBranchExcluded,
          dashboardBranches(data, localRoots)
        )
        const prs = parseDashboard(data, login, localRoots, excluded).map((pr) => {
          if (!pr.localRepoRoot) return pr
          if (!sessionsByRoot.has(pr.localRepoRoot)) {
            sessionsByRoot.set(
              pr.localRepoRoot,
              new Map(sessionsForRepo(pr.localRepoRoot).map((s) => [s.prNumber, s]))
            )
          }
          const session = sessionsByRoot.get(pr.localRepoRoot)!.get(pr.number)
          if (!session) return pr
          return {
            ...pr,
            sessionStatus: session.pausedAt ? ('paused' as const) : ('in-progress' as const),
            viewedFileCount: session.viewedFiles.length,
          }
        })
        const capped = [...matched]
          .filter(([, { issueCount, returned }]) => issueCount > returned)
          .map(([section]) => section)
        return {
          prs,
          capped,
          login,
          fetchedAt: new Date().toISOString(),
          failed: [...failed].map(([section, error]) => ({ section, error })),
          scopedTo: repos.length,
        }
      },
      onError: catchError,
    })
  )

  // ─── Viewed-file sync (S1) ──────────────────────────────────────────────────

  const pullRequestNodeId = async (repoRoot: string, prNumber: number, nodeId?: string) => {
    if (nodeId) return nodeId
    const { owner, repo } = await ownerAndName(repoRoot)
    const idRaw = await api(repoRoot, {
      path: 'graphql',
      fields: {
        query:
          'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){id}}}',
        o: owner,
        r: repo,
      },
      typedFields: { n: prNumber },
    })
    const idData = JSON.parse(idRaw) as {
      data: { repository: { pullRequest: { id: string } } }
    }
    return idData.data.repository.pullRequest.id
  }

  register(
    defineChannel({
      channel: 'github:file-viewed-set',
      schema: z.object({
        repoRoot: RepoRoot,
        prNumber: z.number().int().positive(),
        nodeId: z.string().min(1).optional(),
        path: z.string().min(1),
        viewed: z.boolean(),
      }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, prNumber, nodeId, path, viewed }) => {
        const pullRequestId = await pullRequestNodeId(repoRoot, prNumber, nodeId)
        const mutationName = viewed ? 'markFileAsViewed' : 'unmarkFileAsViewed'
        const gql = `mutation($id:ID!,$p:String!){${mutationName}(input:{pullRequestId:$id,path:$p}){clientMutationId}}`
        await api(repoRoot, {
          path: 'graphql',
          fields: { query: gql, id: pullRequestId, p: path },
        })
        return { ok: true }
      },
      onError: catchError,
    })
  )

  // One request carrying one aliased mutation per path.
  register(
    defineChannel({
      channel: 'github:files-viewed-set',
      schema: z.object({
        repoRoot: RepoRoot,
        prNumber: z.number().int().positive(),
        nodeId: z.string().min(1).optional(),
        paths: z.array(z.string().min(1)).min(1),
        viewed: z.boolean(),
      }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, prNumber, nodeId, paths, viewed }) => {
        const pullRequestId = await pullRequestNodeId(repoRoot, prNumber, nodeId)
        const mutationName = viewed ? 'markFileAsViewed' : 'unmarkFileAsViewed'
        const variables = paths.map((_, i) => `$p${i}:String!`).join(',')
        const mutations = paths
          .map(
            (_, i) =>
              `m${i}:${mutationName}(input:{pullRequestId:$id,path:$p${i}}){clientMutationId}`
          )
          .join(' ')
        await api(repoRoot, {
          path: 'graphql',
          fields: {
            query: `mutation($id:ID!,${variables}){${mutations}}`,
            id: pullRequestId,
            ...Object.fromEntries(paths.map((p, i) => [`p${i}`, p])),
          },
        })
        return { ok: true }
      },
      onError: catchError,
    })
  )

  // ─── Historical diff compare (S1) ──────────────────────────────────────────

  register(
    defineChannel({
      channel: 'github:pr-compare',
      schema: z.object({
        repoRoot: RepoRoot,
        fromSha: z.string().min(1),
        toSha: z.string().min(1),
      }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, fromSha, toSha }) => {
        const { owner, repo } = await ownerAndName(repoRoot)
        const raw = await api(repoRoot, {
          path: `repos/${owner}/${repo}/compare/${fromSha}...${toSha}`,
        })
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
      },
      onError: (e) => {
        const msg = String(e)
        if (
          msg.includes('404') ||
          msg.includes('No common ancestor') ||
          msg.includes('Not Found')
        ) {
          return { rewritten: true, commits: 0, files: [] }
        }
        return catchError(e)
      },
    })
  )

  register(
    defineChannel({
      channel: 'github:tests-for-block',
      schema: z.object({
        repoRoot: RepoRoot,
        headSHA: z.string().min(1),
        path: z.string().min(1),
        code: z.string(),
        hunkHeader: z.string().optional(),
      }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, headSHA, path, code, hunkHeader }) => {
        const symbols = await symbolsForBlock(path, code, hunkHeader)
        const locations = await findTestLocations(repoRoot, headSHA, symbols, runGit)
        return { symbols, locations }
      },
    })
  )

  // ─── Clone for diff-only review (uncloned PRs) ─────────────────────────────

  register(
    defineChannel({
      channel: 'github:clone-repo',
      schema: z.object({ repo: z.string().min(1), folder: z.string().min(1) }),
      invalid: VALIDATION_ERROR,
      run: async ({ repo, folder }) => {
        if (!existsSync(folder)) return { error: 'FOLDER_NOT_FOUND' }
        const name = repo.split('/')[1] ?? repo
        await github.repositories.clone(target(folder), repo, name)
        return { repoRoot: join(folder, name) }
      },
      onError: catchError,
    })
  )
}

/**
 * One session per PR. v2 keys are "repo:::pr"; v1 keys are "repo:::pr:::sha".
 * When both exist for the same PR, the new key wins — it's the one v2 code keeps current.
 */
function sessionsForRepo(repoRoot: string): ReviewSession[] {
  const prefix = `${repoRoot}:::`
  const byPrNumber = new Map<number, { session: ReviewSession; isNewKey: boolean }>()
  for (const [key, value] of Object.entries(sessionStore().store)) {
    if (!key.startsWith(prefix)) continue
    const result = ReviewSessionSchema.safeParse(value)
    if (!result.success) continue
    const isNewKey = !key.slice(prefix.length).includes(':::')
    const existing = byPrNumber.get(result.data.prNumber)
    if (!existing || (isNewKey && !existing.isNewKey)) {
      byPrNumber.set(result.data.prNumber, { session: result.data, isNewKey })
    }
  }
  return Array.from(byPrNumber.values()).map((v) => v.session)
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

interface FileMetrics {
  churn90d: number
  blastRadius: number
  topImporters: string[]
  importerCount: number
  testFilePresent: boolean
  patchCoverage: number | null
}

const REMOTE_FILE_METRICS: FileMetrics = {
  churn90d: 0,
  blastRadius: 0,
  topImporters: [],
  importerCount: 0,
  testFilePresent: false,
  patchCoverage: null,
}

const BATCH_MAX_BUFFER = 20 * 1024 * 1024

function isTestPath(path: string): boolean {
  return (
    /\.(spec|test)\.[^.]+$/.test(path) || // JS/TS: foo.spec.ts, foo.test.js
    /(?:^|\/)test_[^/]+$/.test(path) || // Python/Ruby: test_foo.py
    /_test\.[^.]+$/.test(path) || // Go/Python: foo_test.go, foo_test.py
    /_spec\.[^.]+$/.test(path) || // Ruby: foo_spec.rb
    /Tests?\.[^.]+$/.test(path) || // Java/Kotlin/C#: FooTest.java, FooTests.cs
    /Spec\.[^.]+$/.test(path) // JVM/C#: FooSpec.kt
  )
}

const stemOf = (path: string) => basename(path, `.${basename(path).split('.').pop()}`)

// Match actual import/require/from statements only — not plain-text mentions in markdown or comments.
// No extension allowlist: the pattern itself is the filter. Any language that uses import/require/from
// syntax will be found; prose files (markdown, YAML, JSON, gitignore…) won't match.
const importPatternFor = (path: string) => `(from|require|import).*['"./]` + stemOf(path) + `['"/]`

/** The files that import each path, from one search for every stem (per-file searches if it overflows). */
async function importersFor(repoRoot: string, paths: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  const perFile = async () => {
    for (const path of paths) {
      const raw = await runGit(repoRoot, [
        'grep',
        '-rl',
        '--extended-regexp',
        importPatternFor(path),
      ]).catch(() => '')
      result.set(
        path,
        raw.split('\n').filter((l) => l && l !== path)
      )
    }
    return result
  }
  if (paths.length === 0) return result
  const stems = [...new Set(paths.map(stemOf))]
  let raw: string
  try {
    raw = await runGit(
      repoRoot,
      [
        'grep',
        '-n',
        '--null',
        '--extended-regexp',
        `(from|require|import).*['"./](${stems.join('|')})['"/]`,
      ],
      { maxBuffer: BATCH_MAX_BUFFER }
    )
  } catch (e) {
    if (isOverflow(e)) return perFile()
    // No match exits 1 with nothing on stdout; any other failure is retried per file.
    if ((e as { code?: number } | null)?.code === 1) return fillEmpty(result, paths)
    return perFile()
  }
  const matchers = paths.map((path) => ({ path, re: new RegExp(importPatternFor(path)) }))
  const found = new Map<string, Set<string>>(paths.map((p) => [p, new Set<string>()]))
  for (const line of raw.split('\n')) {
    const nul = line.indexOf('\0')
    if (nul < 0) continue
    const file = line.slice(0, nul)
    const text = line.slice(nul + 1)
    for (const { path, re } of matchers) {
      if (file !== path && re.test(text)) found.get(path)!.add(file)
    }
  }
  for (const path of paths) result.set(path, [...found.get(path)!])
  return result
}

function fillEmpty(result: Map<string, string[]>, paths: string[]) {
  for (const path of paths) result.set(path, [])
  return result
}

// Whether a test file exists for the path, answered from one listing of every test file.
function hasTestFile(testFiles: string[], path: string): boolean {
  const stem = stemOf(path).replace(/[.+^${}()|[\]\\?]/g, '\\$&')
  const re = new RegExp(`^.*/${stem}.*\\.(spec|test)\\..*$`)
  return testFiles.some((f) => re.test(f))
}

/** Reads each coverage report at most once, however many paths are looked up. */
function coverageReader(repoRoot: string): (filePath: string) => Promise<number | null> {
  const read = (name: string) => {
    let pending: Promise<string | null> | undefined
    return () =>
      (pending ??= readFile(join(repoRoot, 'coverage', name), 'utf-8').then(
        (raw) => raw,
        () => null
      ))
  }
  const summaryText = read('coverage-summary.json')
  const lcovText = read('lcov.info')

  return async (filePath) => {
    // Try Istanbul/nyc coverage-summary.json first
    try {
      const raw = await summaryText()
      if (raw !== null) {
        const summary = JSON.parse(raw) as Record<string, { lines?: { pct?: number } }>
        // Keys use absolute or relative paths — try both
        const candidates = [filePath, join(repoRoot, filePath), `./${filePath}`]
        for (const key of candidates) {
          if (summary[key]?.lines?.pct != null) return Math.round(summary[key].lines!.pct!)
        }
        // Partial match: key ends with filePath
        const match = Object.entries(summary).find(([k]) => k.endsWith(filePath))
        if (match) return Math.round(match[1]?.lines?.pct ?? 0)
      }
    } catch {
      /* parse error — fall through */
    }

    // Try lcov.info
    const raw = await lcovText()
    if (raw !== null) {
      for (const section of raw.split('end_of_record')) {
        if (!section.includes(filePath)) continue
        const linesFound = Number(section.match(/LF:(\d+)/)?.[1] ?? '0')
        const linesHit = Number(section.match(/LH:(\d+)/)?.[1] ?? '0')
        if (linesFound > 0) return Math.round((linesHit / linesFound) * 100)
      }
    }
    return null
  }
}
