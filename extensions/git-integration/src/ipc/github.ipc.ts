import { z } from 'zod'
import Store from 'electron-store'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { basename, join } from 'path'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import type {
  ReviewQueuePR,
  PrReviewDetail,
  InlineComment,
  StatusCheck,
} from '../schemas/pr-review.schema.js'
import { ReviewSessionSchema } from '../schemas/pr-review.schema.js'
import { buildChapters, parseReviewQueuePR } from '../github/pr-review-service.js'
import type { FileDiff } from '../schemas/git.schema.js'
import { FileDiffSchema } from '../schemas/git.schema.js'

const execFileAsync = promisify(execFile)

type RegisterFn = (
  channel: string,
  handler: (payload: unknown) => Promise<unknown> | unknown
) => void

interface GhOptions {
  getGhPath: () => string
  getToken: () => string
}

const sessionStore = new Store<Record<string, unknown>>({ name: 'pr-review-sessions' })

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Packaged Electron apps don't inherit the shell PATH, so we probe common
// locations where `gh` is installed on macOS before falling back to the name.
const GH_CANDIDATE_PATHS = [
  '/opt/homebrew/bin/gh', // Apple Silicon Homebrew
  '/usr/local/bin/gh', // Intel Homebrew
  '/usr/bin/gh',
]

let autoResolvedGhPath: string | null = null

async function resolveGh(configuredPath: string): Promise<string> {
  if (configuredPath) return configuredPath
  if (autoResolvedGhPath) return autoResolvedGhPath
  for (const p of GH_CANDIDATE_PATHS) {
    if (existsSync(p)) {
      autoResolvedGhPath = p
      return p
    }
  }
  autoResolvedGhPath = 'gh'
  return autoResolvedGhPath
}

function isAuthError(e: unknown): boolean {
  const msg = String(e)
  return msg.includes('gh auth login') || msg.includes('GH_TOKEN') || msg.includes('401')
}

async function runGh(
  cwd: string,
  args: string[],
  opts: GhOptions,
  timeoutMs = 30_000
): Promise<string> {
  const gh = await resolveGh(opts.getGhPath())
  const token = opts.getToken()
  const env = token ? { ...process.env, GH_TOKEN: token } : undefined
  const { stdout, stderr } = await execFileAsync(gh, args, { cwd, timeout: timeoutMs, env })
  if (stderr && !stdout) throw new Error(stderr)
  return stdout.trim()
}

async function getRepoOwnerAndName(
  repoRoot: string,
  opts: GhOptions
): Promise<{ owner: string; repo: string }> {
  const raw = await runGh(repoRoot, ['repo', 'view', '--json', 'owner,name'], opts)
  const data = JSON.parse(raw) as { owner: { login: string }; name: string }
  return { owner: data.owner.login, repo: data.name }
}

function normalizeGraphQLNode(node: unknown): Record<string, unknown> {
  const obj = node as Record<string, unknown>
  type CommitContext = { name?: string; context?: string; conclusion?: string; state?: string }
  type CommitNode = { commit?: { statusCheckRollup?: { contexts?: { nodes?: CommitContext[] } } } }
  type CommitsField = { nodes?: CommitNode[] }
  const commits = obj.commits as CommitsField | undefined
  const contextNodes = commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []
  const statusCheckRollup = contextNodes.map((ctx) => ({
    name: ctx.name ?? ctx.context ?? '',
    state: ctx.conclusion ?? ctx.state ?? '',
    conclusion: ctx.conclusion ?? ctx.state ?? '',
  }))
  return { ...obj, statusCheckRollup }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 30_000 })
  return stdout.trim()
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerGithubHandlers(register: RegisterFn, opts: GhOptions): void {
  const gh = (cwd: string, args: string[], timeoutMs?: number) => runGh(cwd, args, opts, timeoutMs)
  const ownerAndName = (repoRoot: string) => getRepoOwnerAndName(repoRoot, opts)
  const catchError = (e: unknown) => {
    if (isAuthError(e)) return { error: 'NOT_AUTHENTICATED' as const }
    const msg = String(e)
    if (msg.includes('rate limit') || msg.includes('API rate limit')) {
      return { error: 'RATE_LIMITED' as const, resetAt: Date.now() + 60_000 }
    }
    return { error: msg }
  }

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
    const PR_JSON_FIELDS =
      'number,title,author,createdAt,headRefName,baseRefName,isDraft,statusCheckRollup,files,additions,deletions'

    try {
      // PR number lookup — always finds the PR regardless of state
      if (search && /^\d+$/.test(search.trim())) {
        const raw = await gh(repoRoot, ['pr', 'view', search.trim(), '--json', PR_JSON_FIELDS])
        const pr = parseReviewQueuePR(JSON.parse(raw))
        return { prs: [pr], hasMore: false }
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
        return { prs, hasMore: false }
      }

      // Paginated load via GraphQL
      const { owner, repo } = await ownerAndName(repoRoot)
      const gqlStates = includeClosedPrs ? '[OPEN,CLOSED,MERGED]' : 'OPEN'
      const gql = `query($owner:String!,$repo:String!,$cursor:String){repository(owner:$owner,name:$repo){pullRequests(first:20,states:${gqlStates},after:$cursor,orderBy:{field:CREATED_AT,direction:DESC}){pageInfo{endCursor hasNextPage}nodes{number title isDraft additions deletions createdAt headRefName baseRefName changedFiles author{login avatarUrl}commits(last:1){nodes{commit{statusCheckRollup{contexts(first:20){nodes{...on CheckRun{name conclusion status}...on StatusContext{context state}}}}}}}}}}}`
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
              pageInfo: { endCursor: string; hasNextPage: boolean }
              nodes: unknown[]
            }
          }
        }
      }
      const data = JSON.parse(raw) as GQLResponse
      const { nodes, pageInfo } = data.data.repository.pullRequests
      const prs: ReviewQueuePR[] = nodes.map((n) => parseReviewQueuePR(normalizeGraphQLNode(n)))
      return {
        prs,
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
      const [metaRaw, filesRaw] = await Promise.all([
        gh(repoRoot, [
          'pr',
          'view',
          String(prNumber),
          '--json',
          'number,title,body,author,createdAt,headRefName,baseRefName,headRefOid,statusCheckRollup',
        ]),
        gh(repoRoot, ['pr', 'view', String(prNumber), '--json', 'files']),
      ])
      const meta = JSON.parse(metaRaw) as Record<string, unknown>
      const filesData = (JSON.parse(filesRaw) as { files: unknown[] }).files
      const chapters = buildChapters(filesData)
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
        ciStatus: mapCiStatus(meta.statusCheckRollup),
        lintStatus: mapCheckStatus(meta.statusCheckRollup, LINT_CHECK_NAMES),
        coverageStatus: mapCheckStatus(meta.statusCheckRollup, COVERAGE_CHECK_NAMES),
        statusChecks: mapStatusChecks(meta.statusCheckRollup),
        chapters,
      }
      return { pr }
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
    try {
      const stem = basename(path, `.${basename(path).split('.').pop()}`)
      // Match actual import/require/from statements only — not plain-text mentions in markdown or comments.
      // No extension allowlist: the pattern itself is the filter. Any language that uses import/require/from
      // syntax will be found; prose files (markdown, YAML, JSON, gitignore…) won't match.
      const importPattern = `(from|require|import).*['"./]` + stem + `['"/]`
      const [churnRaw, blastRaw, testRaw] = await Promise.all([
        runGit(repoRoot, ['log', '--oneline', '--since=90 days ago', '--', path]),
        runGit(repoRoot, ['grep', '-rl', '--extended-regexp', importPattern]).catch(() => ''),
        runGit(repoRoot, ['ls-files', '--', `**/${stem}*.spec.*`, `**/${stem}*.test.*`]).catch(
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
      const testFilePresent = testRaw ? testRaw.trim().length > 0 : false
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
      return { comments }
    } catch (e) {
      return catchError(e)
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
        `repos/{owner}/{repo}/pulls/${prNumber}/comments`,
        '--method',
        'POST',
        '--field',
        `in_reply_to_id=${inReplyToId}`,
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
      commitId: z.string().min(1),
      event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
      body: z.string(),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber, commitId, event, body } = parsed.data
    try {
      const raw = await gh(repoRoot, [
        'api',
        `repos/{owner}/{repo}/pulls/${prNumber}/reviews`,
        '--method',
        'POST',
        '--field',
        `commit_id=${commitId}`,
        '--field',
        `event=${event}`,
        '--field',
        `body=${body}`,
      ])
      const data = JSON.parse(raw) as Record<string, unknown>
      return { reviewId: Number(data.id) }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('github:sessions-for-repo', (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { sessions: [] }
    const { repoRoot } = parsed.data
    const all = sessionStore.store
    const sessions: unknown[] = []
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(`${repoRoot}:::`)) continue
      const result = ReviewSessionSchema.safeParse(value)
      if (result.success) sessions.push(result.data)
    }
    return { sessions }
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
}

// ─── Private helpers ──────────────────────────────────────────────────────────

const LINT_CHECK_NAMES = [
  'lint',
  'eslint',
  'rubocop',
  'flake8',
  'pylint',
  'stylelint',
  'prettier',
  'tslint',
]
const COVERAGE_CHECK_NAMES = ['coverage', 'codecov', 'coveralls', 'sonar', 'codeclimate', 'lcov']

const NON_BLOCKING = new Set(['SKIPPED', 'NEUTRAL', 'CANCELLED', 'STALE'])

function mapCiStatus(rollup: unknown): 'passing' | 'failing' | 'pending' | 'none' {
  if (!rollup || !Array.isArray(rollup) || rollup.length === 0) return 'none'
  // Normalise: gh returns `conclusion` on CheckRuns; StatusContext uses `state`
  const statuses = (rollup as Array<Record<string, unknown>>).map((s) =>
    String(s.conclusion ?? s.state ?? '').toUpperCase()
  )
  if (
    statuses.some(
      (s) => s === 'FAILURE' || s === 'ERROR' || s === 'TIMED_OUT' || s === 'ACTION_REQUIRED'
    )
  )
    return 'failing'
  if (
    statuses.some(
      (s) => s === 'PENDING' || s === 'IN_PROGRESS' || s === 'QUEUED' || s === 'WAITING'
    )
  )
    return 'pending'
  // SKIPPED / NEUTRAL / CANCELLED are non-blocking; pass if at least one check succeeded
  if (statuses.some((s) => s === 'SUCCESS')) return 'passing'
  return 'none'
}

function mapCheckStatus(rollup: unknown, names: string[]): 'pass' | 'fail' | 'warn' | 'unknown' {
  if (!rollup || !Array.isArray(rollup) || rollup.length === 0) return 'unknown'
  const checks = (rollup as Array<Record<string, unknown>>).filter((s) => {
    const name = String(s.name ?? s.context ?? '').toLowerCase()
    return names.some((n) => name.includes(n))
  })
  if (checks.length === 0) return 'unknown'
  const statuses = checks.map((s) => String(s.conclusion ?? s.state ?? '').toUpperCase())
  if (statuses.some((s) => s === 'FAILURE' || s === 'ERROR' || s === 'TIMED_OUT')) return 'fail'
  if (statuses.some((s) => s === 'PENDING' || s === 'IN_PROGRESS' || s === 'QUEUED')) return 'warn'
  if (statuses.some((s) => s === 'SUCCESS')) return 'pass'
  if (statuses.every((s) => NON_BLOCKING.has(s))) return 'unknown'
  return 'unknown'
}

function mapStatusChecks(rollup: unknown): StatusCheck[] {
  if (!rollup || !Array.isArray(rollup)) return []
  return (rollup as Array<Record<string, unknown>>).map((s) => {
    const raw = String(s.conclusion ?? s.state ?? '').toUpperCase()
    const state: StatusCheck['state'] =
      raw === 'SUCCESS'
        ? 'pass'
        : raw === 'FAILURE' || raw === 'ERROR' || raw === 'TIMED_OUT' || raw === 'ACTION_REQUIRED'
          ? 'fail'
          : raw === 'PENDING' || raw === 'IN_PROGRESS' || raw === 'QUEUED' || raw === 'WAITING'
            ? 'pending'
            : raw === 'SKIPPED' || raw === 'NEUTRAL' || raw === 'CANCELLED'
              ? 'skipped'
              : 'unknown'
    return {
      name: String(s.name ?? s.context ?? 'Unknown check'),
      state,
      url: s.url ? String(s.url) : undefined,
    }
  })
}

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

function mapComment(raw: unknown): InlineComment {
  const obj = raw as Record<string, unknown>
  const user = (obj.user ?? obj.author ?? {}) as Record<string, unknown>
  const id = Number(obj.id)
  const inReplyTo = obj.in_reply_to_id != null ? Number(obj.in_reply_to_id) : null
  return {
    id,
    author: String(user.login ?? ''),
    authorAvatarUrl: String(user.avatar_url ?? ''),
    body: String(obj.body ?? ''),
    createdAt: String(obj.created_at ?? ''),
    updatedAt: String(obj.updated_at ?? ''),
    path: String(obj.path ?? ''),
    line: Number(obj.line ?? 0),
    startLine: obj.start_line != null ? Number(obj.start_line) : null,
    side: (String(obj.side ?? 'RIGHT').toUpperCase() === 'LEFT' ? 'LEFT' : 'RIGHT') as
      | 'LEFT'
      | 'RIGHT',
    diffHunk: String(obj.diff_hunk ?? ''),
    outdated: Boolean(obj.outdated),
    threadId: inReplyTo != null ? String(inReplyTo) : String(id),
    isReply: inReplyTo != null,
    parentId: inReplyTo,
  }
}

function parseDiff(raw: string, filePath: string): FileDiff {
  if (!raw.trim()) {
    return { path: filePath, hunks: [], isBinary: false }
  }
  if (raw.includes('Binary files')) {
    return { path: filePath, hunks: [], isBinary: true }
  }

  const hunks: FileDiff['hunks'] = []
  let currentHunk: FileDiff['hunks'][0] | null = null

  for (const line of raw.split('\n')) {
    if (line.startsWith('@@ ')) {
      if (currentHunk) hunks.push(currentHunk)
      currentHunk = { header: line, lines: [] }
      continue
    }
    if (!currentHunk) continue

    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentHunk.lines.push({
        type: 'add',
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber: null,
      })
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      currentHunk.lines.push({
        type: 'remove',
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber: null,
      })
    } else if (!line.startsWith('---') && !line.startsWith('+++')) {
      currentHunk.lines.push({
        type: 'context',
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber: null,
      })
    }
  }
  if (currentHunk) hunks.push(currentHunk)

  for (const hunk of hunks) {
    const match = hunk.header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    let oldN = match ? parseInt(match[1], 10) : 1
    let newN = match ? parseInt(match[2], 10) : 1
    for (const dl of hunk.lines) {
      if (dl.type === 'add') {
        dl.newLineNumber = newN++
      } else if (dl.type === 'remove') {
        dl.oldLineNumber = oldN++
      } else {
        dl.oldLineNumber = oldN++
        dl.newLineNumber = newN++
      }
    }
  }

  const result = FileDiffSchema.safeParse({ path: filePath, hunks, isBinary: false })
  return result.success ? result.data : { path: filePath, hunks, isBinary: false }
}
