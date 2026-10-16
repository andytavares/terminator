import { execFileSync, spawnSync } from 'node:child_process'

// The stub GitHub's answer to each gh command the app runs, shaped as gh prints it: GitHub's
// JSON with `--jq` applied by jq(1) (https://cli.github.com/manual/gh_api), and on failure
// GitHub's JSON error on stdout with gh's one-line summary on stderr.

interface StubComment {
  id: number
  user: { login: string }
  body: string
  created_at: string
  updated_at: string
}

interface StubReviewComment extends StubComment {
  path: string
  line: number
  start_line: number | null
  side: 'LEFT' | 'RIGHT'
  diff_hunk: string
  in_reply_to_id: number | null
  pull_request_review_id: number | null
}

interface StubReview {
  id: number
  user: { login: string }
  body: string
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'
  submitted_at: string
}

export interface StubPullRequest {
  number: number
  title: string
  body: string
  author: string
  headRefName: string
  baseRefName: string
  isDraft: boolean
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  mergeStateStatus: 'CLEAN' | 'BEHIND' | 'DIRTY'
  createdAt: string
  reviewComments: StubReviewComment[]
  issueComments: StubComment[]
  reviews: StubReview[]
  resolvedCommentIds: number[]
  viewedPaths: string[]
  branchUpdates: number
}

export interface NewStubPullRequest {
  title: string
  headRefName: string
  baseRefName?: string
  body?: string
  author?: string
  isDraft?: boolean
  mergeStateStatus?: StubPullRequest['mergeStateStatus']
}

export interface GhCall {
  args: string[]
  cwd: string
  stdin: string
  repository: string | null
}

export interface GhReply {
  stdout: string
  stderr: string
  exitCode: number
}

export interface StubContext {
  bareRepo: string
  owner: string
  name: string
  viewer: string
  pullRequests: StubPullRequest[]
  nextId: () => number
}

class GhFailure extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

const OPENED_AT = Date.parse('2026-10-01T09:00:00Z')

/** Answers one gh command as gh would print it. */
export function handleGhCall(context: StubContext, call: GhCall): GhReply {
  try {
    syncPullRefs(context)
    return { stdout: ghOutput(context, call), stderr: '', exitCode: 0 }
  } catch (error) {
    if (!(error instanceof GhFailure)) throw error
    if (error.status < 100) return { stdout: '', stderr: `${error.message}\n`, exitCode: 1 }
    const body = JSON.stringify({ message: error.message, status: String(error.status) })
    const summary = `gh: ${error.message} (HTTP ${error.status})\n`
    return { stdout: body, stderr: summary, exitCode: 1 }
  }
}

function ghOutput(context: StubContext, call: GhCall): string {
  const [command, ...rest] = call.args
  if (command === 'api') return apiCommand(context, call)
  if (command === 'pr') return prCommand(context, rest)
  if (command === 'repo') return repoCommand(context, rest, call.cwd)
  throw new GhFailure(1, `unknown command "${command}"`)
}

// ─── Git, in the bare repository ─────────────────────────────────────────────

function bareGit(context: StubContext, ...args: string[]): string {
  return execFileSync('git', args, { cwd: context.bareRepo, encoding: 'utf8' }).trim()
}

function resolves(context: StubContext, ref: string): boolean {
  try {
    bareGit(context, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`)
    return true
  } catch {
    return false
  }
}

/** As on GitHub, an open pull request's `pull/N/head` follows its branch. */
function syncPullRefs(context: StubContext): void {
  for (const pr of context.pullRequests.filter((p) => p.state === 'OPEN')) {
    bareGit(context, 'update-ref', `refs/pull/${pr.number}/head`, `refs/heads/${pr.headRefName}`)
  }
}

function headSha(context: StubContext, pr: StubPullRequest): string {
  return bareGit(context, 'rev-parse', `refs/pull/${pr.number}/head`)
}

const STATUS_NAMES: Record<string, string> = { A: 'added', M: 'modified', D: 'removed' }

/** GitHub's per-file patch: the unified diff from the first hunk header on. */
function filePatch(context: StubContext, range: string, path: string): string {
  const diff = bareGit(context, 'diff', range, '--', path)
  const start = diff.indexOf('@@')
  return start === -1 ? '' : diff.slice(start)
}

/** GitHub's REST file list for a `base...head` range. */
function filesChangedIn(context: StubContext, range: string) {
  const statuses = bareGit(context, 'diff', '--name-status', range).split('\n')
  const statusOf = new Map(statuses.map((line) => [line.split('\t').at(-1), line[0]] as const))
  return bareGit(context, 'diff', '--numstat', range)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [additions, deletions, filename] = line.split('\t')
      return {
        filename,
        status: STATUS_NAMES[statusOf.get(filename) ?? 'M'] ?? 'modified',
        additions: Number(additions),
        deletions: Number(deletions),
        changes: Number(additions) + Number(deletions),
        patch: filePatch(context, range, filename),
      }
    })
}

function pullRequestFiles(context: StubContext, pr: StubPullRequest) {
  return filesChangedIn(context, `refs/heads/${pr.baseRefName}...${headSha(context, pr)}`)
}

// ─── Pull requests ───────────────────────────────────────────────────────────

export function findPullRequest(context: StubContext, number: number): StubPullRequest {
  const found = context.pullRequests.find((pr) => pr.number === number)
  if (!found) throw new GhFailure(404, 'Not Found')
  return found
}

export function addPullRequest(context: StubContext, input: NewStubPullRequest): StubPullRequest {
  const number = context.pullRequests.reduce((max, pr) => Math.max(max, pr.number), 0) + 1
  bareGit(context, 'update-ref', `refs/pull/${number}/head`, `refs/heads/${input.headRefName}`)
  const pr: StubPullRequest = {
    number,
    title: input.title,
    body: input.body ?? '',
    author: input.author ?? 'octo-author',
    headRefName: input.headRefName,
    baseRefName: input.baseRefName ?? 'main',
    isDraft: input.isDraft ?? false,
    state: 'OPEN',
    mergeStateStatus: input.mergeStateStatus ?? 'CLEAN',
    createdAt: new Date(OPENED_AT + number * 60_000).toISOString(),
    reviewComments: [],
    issueComments: [],
    reviews: [],
    resolvedCommentIds: [],
    viewedPaths: [],
    branchUpdates: 0,
  }
  context.pullRequests.push(pr)
  return pr
}

const reviewAuthors = (pr: StubPullRequest) =>
  pr.reviews.map((r) => ({ author: { login: r.user.login, avatarUrl: '' }, state: r.state }))

/** What `gh pr view --json` and `gh pr list --json` know about a pull request. */
function pullRequestJson(context: StubContext, pr: StubPullRequest): Record<string, unknown> {
  const files = pullRequestFiles(context, pr)
  return {
    id: `PR_node_${pr.number}`,
    number: pr.number,
    title: pr.title,
    body: pr.body,
    state: pr.state,
    url: `https://github.com/${context.owner}/${context.name}/pull/${pr.number}`,
    author: { login: pr.author, avatarUrl: '' },
    createdAt: pr.createdAt,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
    headRefOid: headSha(context, pr),
    isDraft: pr.isDraft,
    mergeStateStatus: pr.mergeStateStatus,
    statusCheckRollup: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    assignees: [],
    files: files.map((f) => ({ path: f.filename, additions: f.additions, deletions: f.deletions })),
    additions: files.reduce((sum, f) => sum + f.additions, 0),
    deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    reviews: reviewAuthors(pr),
    latestReviews: reviewAuthors(pr),
  }
}

function pickFields(json: Record<string, unknown>, fields: string): Record<string, unknown> {
  return Object.fromEntries(fields.split(',').map((field) => [field, json[field]]))
}

/** The value after `flag`, or undefined. */
function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

/** `gh pr view <number|branch>`: a branch names the open pull request whose head it is. */
function viewedPullRequest(context: StubContext, selector: string): StubPullRequest {
  if (/^\d+$/.test(selector)) return findPullRequest(context, Number(selector))
  const pr = context.pullRequests.find((p) => p.headRefName === selector && p.state === 'OPEN')
  if (!pr) throw new GhFailure(1, `no pull requests found for branch "${selector}"`)
  return pr
}

function listPullRequests(context: StubContext, args: string[]): unknown[] {
  const state = (flagValue(args, '--state') ?? 'open').toUpperCase()
  const text = (flagValue(args, '--search') ?? '').toLowerCase()
  return context.pullRequests
    .filter((pr) => state === 'ALL' || pr.state === state)
    .filter((pr) => pr.title.toLowerCase().includes(text))
    .map((pr) => pickFields(pullRequestJson(context, pr), flagValue(args, '--json') ?? 'number'))
}

/** `gh pr create`: the head branch must already be pushed, as on GitHub. */
function createPullRequest(context: StubContext, args: string[]): string {
  const headRefName = flagValue(args, '--head') ?? ''
  if (!resolves(context, `refs/heads/${headRefName}`)) {
    throw new GhFailure(1, 'pull request create failed: Head ref must be a branch')
  }
  if (context.pullRequests.some((pr) => pr.headRefName === headRefName && pr.state === 'OPEN')) {
    throw new GhFailure(1, `a pull request for branch "${headRefName}" already exists`)
  }
  const pr = addPullRequest(context, {
    title: flagValue(args, '--title') ?? '',
    body: flagValue(args, '--body') ?? '',
    headRefName,
    baseRefName: flagValue(args, '--base') ?? 'main',
    author: context.viewer,
    isDraft: args.includes('--draft'),
  })
  return `https://github.com/${context.owner}/${context.name}/pull/${pr.number}\n`
}

function prCommand(context: StubContext, args: string[]): string {
  const [verb, selector] = args
  if (verb === 'view') {
    const json = pullRequestJson(context, viewedPullRequest(context, selector))
    return JSON.stringify(pickFields(json, flagValue(args, '--json') ?? 'number'))
  }
  if (verb === 'list') return JSON.stringify(listPullRequests(context, args))
  if (verb === 'create') return createPullRequest(context, args)
  const pr = findPullRequest(context, Number(selector))
  if (verb === 'ready') pr.isDraft = false
  else if (verb === 'update-branch') {
    pr.branchUpdates += 1
    pr.mergeStateStatus = 'CLEAN'
  } else throw new GhFailure(1, `unknown command "pr ${verb}"`)
  return ''
}

function repoCommand(context: StubContext, args: string[], cwd: string): string {
  const [verb] = args
  if (verb === 'view') {
    const json = { owner: { login: context.owner }, name: context.name }
    return JSON.stringify(pickFields(json, flagValue(args, '--json') ?? 'name'))
  }
  if (verb === 'clone') {
    execFileSync('git', ['clone', '--quiet', context.bareRepo, args[2]], { cwd })
    return ''
  }
  throw new GhFailure(1, `unknown command "repo ${verb}"`)
}

// ─── gh api ──────────────────────────────────────────────────────────────────

interface ApiRequest {
  method: string
  path: string
  query: URLSearchParams
  fields: Record<string, string>
  body: Record<string, unknown>
}

/** Every value after each occurrence of `flag`, as key=value pairs. */
function flagPairs(args: string[], flag: string): Record<string, string> {
  const pairs: Record<string, string> = {}
  args.forEach((arg, index) => {
    if (arg !== flag) return
    const pair = args[index + 1]
    const equals = pair.indexOf('=')
    pairs[pair.slice(0, equals)] = pair.slice(equals + 1)
  })
  return pairs
}

function apiRequest(context: StubContext, call: GhCall): ApiRequest {
  const repository = call.repository ?? `${context.owner}/${context.name}`
  const [owner, repo] = repository.split('/')
  const target = call.args[1].replace('{owner}', owner).replace('{repo}', repo)
  const [path, search = ''] = target.split('?')
  const fields = { ...flagPairs(call.args, '-f'), ...flagPairs(call.args, '-F') }
  const body = call.args.includes('--input') ? (JSON.parse(call.stdin) as ApiRequest['body']) : {}
  const hasParameters = Object.keys(fields).length > 0 || call.args.includes('--input')
  const method = flagValue(call.args, '--method') ?? (hasParameters ? 'POST' : 'GET')
  return { method, path, query: new URLSearchParams(search), fields, body }
}

function apiCommand(context: StubContext, call: GhCall): string {
  const request = apiRequest(context, call)
  const json =
    request.path === 'graphql' ? graphql(context, request) : restResponse(context, request)
  const filter = flagValue(call.args, '--jq')
  if (filter) return applyJq(json, filter)
  return typeof json === 'string' ? json : JSON.stringify(json)
}

/** Applies gh's `--jq` filter the way gh prints it: strings raw, everything else compact JSON. */
function applyJq(json: unknown, filter: string): string {
  const result = spawnSync('jq', ['-r', '-c', filter], {
    input: JSON.stringify(json),
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new GhFailure(1, `jq: ${result.stderr}`)
  return result.stdout
}

// ─── REST ────────────────────────────────────────────────────────────────────

type RestHandler = (context: StubContext, request: ApiRequest, match: RegExpMatchArray) => unknown

const REPO = 'repos/[^/]+/[^/]+'

const REST_ROUTES: Array<[string, RegExp, RestHandler]> = [
  ['GET', /^user$/, (context) => ({ login: context.viewer })],
  ['GET', /^user\/repos$/, (context) => accessibleRepositories(context)],
  ['GET', new RegExp(`^${REPO}/pulls/(\\d+)/files$`), (c, _r, m) => prFiles(c, m)],
  ['GET', new RegExp(`^${REPO}/pulls/(\\d+)/reviews$`), (c, _r, m) => pr(c, m).reviews],
  [
    'POST',
    new RegExp(`^${REPO}/pulls/(\\d+)/reviews$`),
    (c, r, m) => answerSubmittedReview(c, r, m),
  ],
  ['GET', new RegExp(`^${REPO}/pulls/(\\d+)/requested_reviewers$`), () => noReviewers()],
  ['GET', new RegExp(`^${REPO}/pulls/(\\d+)/comments$`), (c, _r, m) => pr(c, m).reviewComments],
  [
    'POST',
    new RegExp(`^${REPO}/pulls/(\\d+)/comments/(\\d+)/replies$`),
    (c, r, m) => replyToComment(c, r, m),
  ],
  ['GET', new RegExp(`^${REPO}/issues/(\\d+)/comments$`), (c, _r, m) => pr(c, m).issueComments],
  ['POST', new RegExp(`^${REPO}/issues/(\\d+)/comments$`), (c, r, m) => addIssueComment(c, r, m)],
  [
    'GET',
    new RegExp(`^${REPO}/compare/([0-9a-f]+)\\.\\.\\.([0-9a-f]+)$`),
    (c, _r, m) => compareRefs(c, m),
  ],
  ['GET', new RegExp(`^${REPO}/commits/[0-9a-f]+/check-suites$`), () => ({ check_suites: [] })],
  ['GET', new RegExp(`^${REPO}/contents/(.+)$`), (c, r, m) => fileContent(c, r, m)],
]

function restResponse(context: StubContext, request: ApiRequest): unknown {
  for (const [method, pattern, handler] of REST_ROUTES) {
    const match = request.path.match(pattern)
    if (match && method === request.method) return handler(context, request, match)
  }
  throw new GhFailure(404, 'Not Found')
}

const pr = (context: StubContext, match: RegExpMatchArray) =>
  findPullRequest(context, Number(match[1]))

const prFiles = (context: StubContext, match: RegExpMatchArray) =>
  pullRequestFiles(context, pr(context, match))

const noReviewers = () => ({ users: [], teams: [] })

function accessibleRepositories(context: StubContext) {
  return [`${context.owner}/${context.name}`, `${context.owner}/gadgets`].map((fullName) => ({
    full_name: fullName,
    owner: { login: context.owner },
    private: false,
    archived: false,
    pushed_at: '2026-10-01T09:00:00Z',
  }))
}

function stamp(context: StubContext, body: string): StubComment {
  const at = new Date().toISOString()
  return {
    id: context.nextId(),
    user: { login: context.viewer },
    body,
    created_at: at,
    updated_at: at,
  }
}

function addIssueComment(context: StubContext, request: ApiRequest, match: RegExpMatchArray) {
  const comment = stamp(context, request.fields.body)
  pr(context, match).issueComments.push(comment)
  return comment
}

function replyToComment(context: StubContext, request: ApiRequest, match: RegExpMatchArray) {
  const pullRequest = pr(context, match)
  const parent = pullRequest.reviewComments.find((c) => c.id === Number(match[2]))
  if (!parent) throw new GhFailure(404, 'Not Found')
  const reply: StubReviewComment = {
    ...parent,
    ...stamp(context, request.fields.body),
    in_reply_to_id: parent.id,
    pull_request_review_id: null,
  }
  pullRequest.reviewComments.push(reply)
  return reply
}

const REVIEW_STATES = {
  APPROVE: 'APPROVED',
  REQUEST_CHANGES: 'CHANGES_REQUESTED',
  COMMENT: 'COMMENTED',
} as const

/** POST .../reviews, with its draft comments in the same request, as GitHub takes them. */
function answerSubmittedReview(context: StubContext, request: ApiRequest, match: RegExpMatchArray) {
  const pullRequest = pr(context, match)
  const input = { ...request.body, ...request.fields } as {
    event: keyof typeof REVIEW_STATES
    body?: string
    comments?: Array<{ path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }>
  }
  if (input.event === 'APPROVE' && pullRequest.author === context.viewer) {
    throw new GhFailure(422, 'Can not approve your own pull request')
  }
  const { id, user, created_at: at } = stamp(context, input.body ?? '')
  const review: StubReview = {
    id,
    user,
    body: input.body ?? '',
    state: REVIEW_STATES[input.event],
    submitted_at: at,
  }
  pullRequest.reviews.push(review)
  for (const comment of input.comments ?? []) {
    addReviewComment(context, pullRequest, { ...comment, reviewId: id })
  }
  return review
}

/** A review's inline comment, with the review it belongs to. */
interface ReviewCommentInput {
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  body: string
  reviewId: number
}

function addReviewComment(
  context: StubContext,
  pullRequest: StubPullRequest,
  comment: ReviewCommentInput
): void {
  pullRequest.reviewComments.push({
    ...stamp(context, comment.body),
    path: comment.path,
    line: comment.line,
    start_line: null,
    side: comment.side,
    diff_hunk: '',
    in_reply_to_id: null,
    pull_request_review_id: comment.reviewId,
  })
}

function compareRefs(context: StubContext, match: RegExpMatchArray) {
  const [, from, to] = match
  if (!resolves(context, from) || !resolves(context, to)) throw new GhFailure(404, 'Not Found')
  const files = filesChangedIn(context, `${from}...${to}`)
  const aheadBy = Number(bareGit(context, 'rev-list', '--count', `${from}..${to}`))
  return { ahead_by: aheadBy, files }
}

/** `contents/<path>?ref=` with the raw media type: the file itself. */
function fileContent(context: StubContext, request: ApiRequest, match: RegExpMatchArray) {
  const path = decodeURIComponent(match[1])
  try {
    return bareGit(context, 'show', `${request.query.get('ref') ?? 'HEAD'}:${path}`)
  } catch {
    throw new GhFailure(404, 'Not Found')
  }
}

// ─── GraphQL ─────────────────────────────────────────────────────────────────

function graphql(context: StubContext, request: ApiRequest): unknown {
  const { query } = request.fields
  if (query.includes('pullRequests(first:')) return openPullRequestPage(context)
  if (query.includes('reviewThreads(first:100)')) return reviewThreads(context, request)
  if (query.includes('pullRequest(number:$n){id}')) return stubPullRequestNodeId(request)
  if (query.includes('markFileAsViewed')) return markPathViewed(context, request)
  if (query.includes('search(query:')) return searchDashboard(context, query)
  throw new GhFailure(1, `stub GitHub cannot answer this query: ${query.slice(0, 80)}`)
}

function openPullRequestPage(context: StubContext) {
  const open = context.pullRequests.filter((pr) => pr.state === 'OPEN')
  const nodes = [...open].reverse().map((pr) => graphqlPullRequest(context, pr))
  const pageInfo = { endCursor: null, hasNextPage: false }
  return { data: { repository: { pullRequests: { totalCount: open.length, pageInfo, nodes } } } }
}

function graphqlPullRequest(context: StubContext, pr: StubPullRequest) {
  const json = pullRequestJson(context, pr)
  const checks = [{ name: 'build', conclusion: 'SUCCESS', status: 'COMPLETED' }]
  return {
    ...json,
    changedFiles: (json.files as unknown[]).length,
    assignees: { nodes: [] },
    latestReviews: { nodes: reviewAuthors(pr) },
    reviewRequests: { nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: checks } } } }] },
  }
}

/** Threads are keyed by their first comment, resolved when the stub says so. */
function reviewThreads(context: StubContext, request: ApiRequest) {
  const pullRequest = findPullRequest(context, Number(request.fields.n))
  const nodes = pullRequest.reviewComments
    .filter((c) => c.in_reply_to_id === null)
    .map((c) => ({
      isResolved: pullRequest.resolvedCommentIds.includes(c.id),
      comments: { nodes: [{ databaseId: c.id }] },
    }))
  return { data: { repository: { pullRequest: { reviewThreads: { nodes } } } } }
}

function stubPullRequestNodeId(request: ApiRequest) {
  return { data: { repository: { pullRequest: { id: `PR_node_${request.fields.n}` } } } }
}

/** markFileAsViewed / unmarkFileAsViewed, one alias per path or a single `$p`. */
function markPathViewed(context: StubContext, request: ApiRequest) {
  const number = Number(request.fields.id.replace('PR_node_', ''))
  const pullRequest = findPullRequest(context, number)
  const paths = Object.entries(request.fields)
    .filter(([key]) => /^p\d*$/.test(key))
    .map(([, path]) => path)
  const viewed = !request.fields.query.includes('unmarkFileAsViewed')
  const others = pullRequest.viewedPaths.filter((path) => !paths.includes(path))
  pullRequest.viewedPaths = viewed ? [...others, ...paths] : others
  return { data: {} }
}

/** The Reviews dashboard: what asks for the viewer's review, and what the viewer opened. */
function searchDashboard(context: StubContext, query: string) {
  const alias = query.match(/(\w+): search\(/)?.[1] ?? ''
  const open = context.pullRequests.filter((pr) => pr.state === 'OPEN')
  const matches =
    alias === 'requested'
      ? open.filter((pr) => pr.author !== context.viewer)
      : alias === 'mine'
        ? open.filter((pr) => pr.author === context.viewer)
        : []
  const nodes = matches.map((pr) => prDashboardNode(context, pr))
  return { data: { [alias]: { issueCount: nodes.length, nodes } } }
}

function prDashboardNode(context: StubContext, pr: StubPullRequest) {
  const json = pullRequestJson(context, pr)
  const head = { oid: json.headRefOid, committedDate: pr.createdAt, statusCheckRollup: null }
  return {
    ...json,
    changedFiles: (json.files as unknown[]).length,
    repository: { nameWithOwner: `${context.owner}/${context.name}` },
    reviewDecision: null,
    reviewRequests: { totalCount: 1 },
    reviewThreads: { nodes: [] },
    commits: { nodes: [{ commit: head }] },
    latestReviews: { nodes: [] },
  }
}
