import type {
  Chapter,
  PrChangedFile,
  ReviewQueuePR,
  IssueRef,
  DryViolation,
} from '../schemas/pr-review.schema.js'
import type { StatusCheck, IssueComment, InlineComment } from '../schemas/pr-review.schema.js'
import type { FileDiff } from '../schemas/git.schema.js'
import { parseDiff } from '../git/git-parser.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ComplexityHotspot {
  hunkIndex: number
  complexityDelta: number
  message: string
}

type SignalValue = 'pass' | 'warn' | 'fail' | 'unknown'
type RawRecord = Record<string, unknown>

interface RawFile {
  path: string
  additions: number
  deletions: number
  changeType?: string
}

/** Totals for a queue row, from its file list when GitHub sent one, else from its counters. */
interface QueueTotals {
  fileCount: number
  additions: number
  deletions: number
}

/** The tracker connection that fills in an issue's title and state. */
export interface IssueLookup {
  get(
    tracker: 'linear',
    key: string,
    opts?: { refresh?: boolean }
  ): Promise<{ title: string; state: { name: string } } | null>
}

interface HunkLines {
  lines: Array<{ type: string; content: string }>
}

type CommitContext = { name?: string; context?: string; conclusion?: string; state?: string }
type CommitNode = { commit?: { statusCheckRollup?: { contexts?: { nodes?: CommitContext[] } } } }
type ReviewNode = {
  author?: { login?: string; avatarUrl?: string }
  state?: string
  submittedAt?: string
}
type ReviewRequestNode = {
  requestedReviewer?: { login?: string; avatarUrl?: string; name?: string }
}
type Nodes<T> = { nodes?: T[] } | undefined

// ─── Chapter building ─────────────────────────────────────────────────────────

/** A directory with fewer changed files than this joins its parent directory's chapter. */
const MIN_CHAPTER_FILES = 3
const ROOT_DIR = ''

function parentDirOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? ROOT_DIR : path.slice(0, slash)
}

function depthOf(dir: string): number {
  return dir.split('/').length
}

function byPath(a: { path: string }, b: { path: string }): number {
  if (a.path === b.path) return 0
  return a.path < b.path ? -1 : 1
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  map.set(key, [...(map.get(key) ?? []), value])
}

/** The deepest directory, other than the root, with too few files for a chapter of its own. */
function deepestSmallDir(groups: Map<string, RawFile[]>): string | undefined {
  return [...groups]
    .filter(([dir, files]) => dir !== ROOT_DIR && files.length < MIN_CHAPTER_FILES)
    .map(([dir]) => dir)
    .sort((a, b) => depthOf(b) - depthOf(a))[0]
}

function groupFilesByDirectory(files: RawFile[]): Map<string, RawFile[]> {
  const groups = new Map<string, RawFile[]>()
  for (const f of files) pushTo(groups, parentDirOf(f.path), f)
  for (let dir = deepestSmallDir(groups); dir !== undefined; dir = deepestSmallDir(groups)) {
    const moved = groups.get(dir) ?? []
    groups.delete(dir)
    for (const f of moved) pushTo(groups, parentDirOf(dir), f)
  }
  return groups
}

/** The first of `keys` set on `obj`. */
function firstOf(obj: object, keys: string[]): unknown {
  return keys.map((k) => (obj as RawRecord)[k]).find((v) => v != null)
}

function rawFileFrom(raw: unknown): RawFile {
  const obj = raw as RawRecord
  return {
    path: String(firstOf(obj, ['path', 'filename']) ?? ''),
    additions: Number(obj.additions ?? 0),
    deletions: Number(obj.deletions ?? 0),
    changeType: String(firstOf(obj, ['changeType', 'status']) ?? 'modified'),
  }
}

function changedFileFrom(f: RawFile): PrChangedFile {
  return {
    path: f.path,
    changeType: mapChangeType(f.changeType ?? 'modified'),
    additions: f.additions,
    deletions: f.deletions,
    isBinary: false,
    whyHere: '',
    churn90d: null,
    blastRadius: null,
  }
}

function chapterFor(
  dir: string,
  groupFiles: RawFile[],
  overrides?: Record<string, string[]>
): Chapter {
  const name = dir === ROOT_DIR ? 'Root' : dir
  const id = name.replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const sorted = [...groupFiles].sort(byPath).map(changedFileFrom)
  return { id, name, files: applyOverrides(sorted, overrides?.[id]), status: 'not-started' }
}

/** Chapters by directory, in path order; applyReadingOrder reorders them afterwards. */
export function buildChapters(
  rawFiles: unknown[],
  overrides?: Record<string, string[]>
): Chapter[] {
  const files = rawFiles.map(rawFileFrom).filter((f) => f.path.length > 0)
  const groups = groupFilesByDirectory(files)
  return [...groups.keys()].sort().map((dir) => chapterFor(dir, groups.get(dir) ?? [], overrides))
}

function applyOverrides(files: PrChangedFile[], order?: string[]): PrChangedFile[] {
  if (!order || order.length === 0) return files
  const fileMap = new Map(files.map((f) => [f.path, f]))
  const ordered: PrChangedFile[] = []
  for (const path of order) {
    const f = fileMap.get(path)
    if (!f) continue
    ordered.push(f)
    fileMap.delete(path)
  }
  return [...ordered, ...fileMap.values()]
}

const CHANGE_TYPES = new Map<string, PrChangedFile['changeType']>([
  ['added', 'added'],
  ['removed', 'deleted'],
  ['deleted', 'deleted'],
  ['renamed', 'renamed'],
])

function mapChangeType(raw: string): PrChangedFile['changeType'] {
  return CHANGE_TYPES.get(raw.toLowerCase()) ?? 'modified'
}

// ─── Check states ─────────────────────────────────────────────────────────────

const FAILED_STATES = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED'])
const RUNNING_STATES = new Set(['PENDING', 'IN_PROGRESS', 'QUEUED'])
const RUNNING_OR_WAITING_STATES = new Set([...RUNNING_STATES, 'WAITING'])
const SKIPPED_STATES = new Set(['SKIPPED', 'NEUTRAL', 'CANCELLED'])
/** mapCheckStatus does not count ACTION_REQUIRED as failed. */
const CHECK_FAILED_STATES = new Set(['FAILURE', 'ERROR', 'TIMED_OUT'])

const CI_STATUS_BY_SIGNAL: Record<SignalValue, ReviewQueuePR['ciStatus']> = {
  fail: 'failing',
  warn: 'pending',
  pass: 'passing',
  unknown: 'none',
}

/** Failed beats running beats succeeded; skipped, neutral or cancelled checks never decide it, so a
 *  rollup of only those is unknown. */
function rollupVerdict(states: string[], failed: Set<string>, running: Set<string>): SignalValue {
  if (states.some((s) => failed.has(s))) return 'fail'
  if (states.some((s) => running.has(s))) return 'warn'
  if (states.some((s) => s === 'SUCCESS')) return 'pass'
  return 'unknown'
}

/** The upper-cased state of each check; gh puts it in `state` or `conclusion`. */
function checkStates(checks: RawRecord[], first: 'state' | 'conclusion'): string[] {
  const second = first === 'state' ? 'conclusion' : 'state'
  return checks.map((s) => String(s[first] ?? s[second] ?? '').toUpperCase())
}

export const LINT_CHECK_NAMES = [
  'lint',
  'eslint',
  'rubocop',
  'flake8',
  'pylint',
  'stylelint',
  'prettier',
  'tslint',
]
function checksNamed(rollup: RawRecord[], keywords: string[]): RawRecord[] {
  return rollup.filter((s) => {
    const name = String(s.name ?? s.context ?? '').toLowerCase()
    return keywords.some((k) => name.includes(k))
  })
}

function asRollup(rollup: unknown): RawRecord[] | null {
  if (!rollup || !Array.isArray(rollup)) return null
  return rollup as RawRecord[]
}

// ─── Queue PR parsing ─────────────────────────────────────────────────────────

function ciSignal(rollup: unknown): SignalValue {
  return rollupVerdict(checkStates(asRollup(rollup) ?? [], 'state'), FAILED_STATES, RUNNING_STATES)
}

function sumOf(files: RawRecord[], key: 'additions' | 'deletions'): number {
  return files.reduce((s, f) => s + Number(f[key] ?? 0), 0)
}

function queueTotals(obj: RawRecord): QueueTotals {
  const files = (obj.files as RawRecord[] | undefined) ?? []
  if (files.length === 0) {
    const [additions, deletions] = [Number(obj.additions ?? 0), Number(obj.deletions ?? 0)]
    return { fileCount: Number(obj.changedFiles ?? 0), additions, deletions }
  }
  const [additions, deletions] = [sumOf(files, 'additions'), sumOf(files, 'deletions')]
  return { fileCount: files.length, additions, deletions }
}

/** Approvers from the REST `reviews` field or GraphQL `latestReviews.nodes`, once each. */
function approversOf(obj: RawRecord): string[] {
  const reviews =
    (obj.reviews as RawRecord[] | undefined) ?? (obj.latestReviews as Nodes<RawRecord>)?.nodes ?? []
  const approvers = reviews
    .filter((r) => String(r.state ?? '').toUpperCase() === 'APPROVED')
    .map((r) => String(((r.author as RawRecord) ?? {}).login ?? ''))
    .filter(Boolean)
  return [...new Set(approvers)]
}

/** Assignees as normalizeGraphQLNode flattens them, or from the REST `assignees` field. */
export function assigneeLoginsOf(obj: RawRecord): string[] {
  if (Array.isArray(obj.assigneeLogins)) return obj.assigneeLogins as string[]
  if (!Array.isArray(obj.assignees)) return []
  return (obj.assignees as RawRecord[]).map((a) => String(a.login ?? '')).filter(Boolean)
}

const PR_STATES: Record<string, 'merged' | 'closed'> = { MERGED: 'merged', CLOSED: 'closed' }

const QUEUE_MERGE_STATES: Record<string, ReviewQueuePR['mergeStateStatus']> = {
  BEHIND: 'behind',
  DIRTY: 'dirty',
  CLEAN: 'clean',
  HAS_HOOKS: 'clean',
}

function upper(value: unknown): string {
  return String(value ?? '').toUpperCase()
}

export function asText(value: unknown): string {
  return String(value ?? '')
}

/** Who and what the PR is: number, title, author, branches, state. */
function queueIdentity(obj: RawRecord) {
  const author = (obj.author ?? {}) as RawRecord
  return {
    number: Number(obj.number),
    title: asText(obj.title),
    author: asText(author.login),
    authorAvatarUrl: asText(author.avatarUrl),
    openedAt: asText(obj.createdAt),
    headRefName: asText(obj.headRefName),
    baseRefName: asText(obj.baseRefName),
    state: PR_STATES[upper(obj.state)] ?? 'open',
    isDraft: Boolean(obj.isDraft),
  }
}

/** Where review stands: approvals, requested reviewers, assignees and mergeability. */
function queueReviewState(obj: RawRecord) {
  const approvedBy = approversOf(obj)
  const requested = obj.requestedReviewers
  return {
    approvalCount: approvedBy.length,
    approvedBy,
    requestedReviewers: Array.isArray(requested) ? (requested as string[]) : [],
    assigneeLogins: assigneeLoginsOf(obj),
    mergeStateStatus: QUEUE_MERGE_STATES[upper(obj.mergeStateStatus)] ?? 'unknown',
  }
}

export function parseReviewQueuePR(raw: unknown): ReviewQueuePR {
  const obj = raw as RawRecord
  const totals = queueTotals(obj)
  return {
    ...queueIdentity(obj),
    ciStatus: CI_STATUS_BY_SIGNAL[ciSignal(obj.statusCheckRollup)],
    fileCount: totals.fileCount,
    additions: totals.additions,
    deletions: totals.deletions,
    sessionStatus: 'not-started',
    viewedFileCount: 0,
    ...queueReviewState(obj),
  }
}

// ─── Hunk classification (formatting vs semantic) ─────────────────────────────

function trimmedLinesOf(hunk: HunkLines, type: 'add' | 'remove'): string[] {
  return hunk.lines.filter((l) => l.type === type).map((l) => l.content.trim())
}

function sameMultiset(a: string[], b: string[]): boolean {
  const counts = new Map<string, number>()
  for (const line of a) counts.set(line, (counts.get(line) ?? 0) + 1)
  for (const line of b) counts.set(line, (counts.get(line) ?? 0) - 1)
  return [...counts.values()].every((v) => v === 0)
}

/** Formatting when the added and removed lines are the same multiset once trimmed. */
export function classifyHunk(hunk: HunkLines): 'semantic' | 'formatting' {
  const added = trimmedLinesOf(hunk, 'add')
  const removed = trimmedLinesOf(hunk, 'remove')
  // A hunk of only context lines changes nothing to filter out.
  if (added.length === 0 && removed.length === 0) return 'semantic'
  if (added.length !== removed.length) return 'semantic'
  if (sameMultiset(added, removed)) return 'formatting'
  return 'semantic'
}

// ─── Issue reference extraction ───────────────────────────────────────────────

export function extractIssueRefs(body: string): IssueRef[] {
  // GitHub: Fixes #123, Closes #456, Resolves #789, Related #012
  const github = [...body.matchAll(/(?:fixes|closes|resolves|related)\s+#(\d+)/gi)].map(
    (m): IssueRef => ({ type: 'github', ref: `#${m[1]}` })
  )
  // Linear: https://linear.app/team/issue/TEAM-123
  const linear = [...body.matchAll(/https?:\/\/linear\.app\/[^\s/]+\/issue\/([A-Z]+-\d+)/g)].map(
    (m): IssueRef => ({ type: 'linear', ref: m[1], url: m[0] })
  )
  // Jira: https://your-team.atlassian.net/browse/TEAM-123
  const jira = [
    ...body.matchAll(/https?:\/\/[^\s/]+\.atlassian\.net\/browse\/([A-Z][A-Z0-9]*-\d+)/g),
  ].map((m): IssueRef => ({ type: 'jira', ref: m[1], url: m[0] }))
  return [...github, ...linear, ...jira]
}

async function enrichIssueRef(ref: IssueRef, issues: IssueLookup): Promise<IssueRef> {
  // Jira links are recognised in PR text, but no Jira connection exists to enrich them.
  if (ref.type !== 'linear') return ref
  try {
    const issue = await issues.get(ref.type, ref.ref)
    if (issue === null) return ref
    return { ...ref, title: issue.title, state: issue.state.name }
  } catch {
    return ref
  }
}

/**
 * Adds each tracker issue's title and state, which a key scraped from the PR body
 * cannot carry. Best-effort: an unconnected or unreachable tracker leaves refs as they are.
 */
export async function enrichIssueRefs(
  refs: IssueRef[],
  issues: IssueLookup | undefined
): Promise<IssueRef[]> {
  if (!issues) return refs
  return Promise.all(refs.map((ref) => enrichIssueRef(ref, issues)))
}

// ─── DRY violation detection ──────────────────────────────────────────────────

const DRY_WINDOW = 5

function normalizeForDry(line: string): string {
  return line
    .replace(/\s+/g, ' ')
    .replace(/['"`]/g, '"')
    .replace(/\b[a-z_][a-zA-Z0-9_]*\b/g, 'X')
    .replace(/\d+/g, 'N')
    .trim()
}

/** Each run of DRY_WINDOW normalized added lines in `patch`. */
function addedLineWindows(patch: string): string[] {
  const added = patch
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => normalizeForDry(l.slice(1)))
    .filter((l) => l.length > 10)
  const windows: string[] = []
  for (let i = 0; i + DRY_WINDOW <= added.length; i++) {
    windows.push(added.slice(i, i + DRY_WINDOW).join('\n'))
  }
  return windows
}

export function detectDryViolations(
  files: Array<{ path: string; patch?: string }>
): DryViolation[] {
  const fingerprints = new Map<string, Set<string>>()
  for (const file of files) {
    for (const block of addedLineWindows(file.patch ?? '')) {
      fingerprints.set(block, (fingerprints.get(block) ?? new Set()).add(file.path))
    }
  }
  return [...fingerprints]
    .filter(([, fileSet]) => fileSet.size >= 2)
    .map(([fingerprint, fileSet]) => ({
      files: [...fileSet],
      fingerprint,
      lineCount: DRY_WINDOW,
    }))
}

// ─── gh response mappers (pure; moved from github.ipc.ts) ────────────────────

function rollupFromCommits(obj: RawRecord): RawRecord[] {
  const commits = obj.commits as Nodes<CommitNode>
  const contexts = commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []
  return contexts.map((ctx) => {
    const state = asText(firstOf(ctx, ['conclusion', 'state']))
    return { name: asText(firstOf(ctx, ['name', 'context'])), state, conclusion: state }
  })
}

function requestedReviewerLogins(obj: RawRecord): string[] {
  const nodes = (obj.reviewRequests as Nodes<ReviewRequestNode>)?.nodes ?? []
  return nodes
    .map((n) => n.requestedReviewer?.login ?? n.requestedReviewer?.name ?? '')
    .filter(Boolean)
}

export function normalizeGraphQLNode(node: unknown): Record<string, unknown> {
  const obj = node as RawRecord
  const assigneeNodes = (obj.assignees as Nodes<{ login?: string }>)?.nodes ?? []
  return {
    ...obj,
    statusCheckRollup: rollupFromCommits(obj),
    latestReviews: { nodes: (obj.latestReviews as Nodes<ReviewNode>)?.nodes ?? [] },
    requestedReviewers: requestedReviewerLogins(obj),
    assigneeLogins: assigneeNodes.map((n) => n.login ?? '').filter(Boolean),
  }
}

const MERGE_STATES: Record<string, 'behind' | 'dirty' | 'clean'> = {
  BEHIND: 'behind',
  DIRTY: 'dirty',
  CONFLICTING: 'dirty',
  CLEAN: 'clean',
  HAS_HOOKS: 'clean',
  UNSTABLE: 'clean',
  BLOCKED: 'clean',
}

export function mapMergeStateStatus(raw: string): 'behind' | 'dirty' | 'clean' | 'unknown' {
  return MERGE_STATES[raw.toUpperCase()] ?? 'unknown'
}

export function mapCiStatus(rollup: unknown): 'passing' | 'failing' | 'pending' | 'none' {
  const states = checkStates(asRollup(rollup) ?? [], 'conclusion')
  return CI_STATUS_BY_SIGNAL[rollupVerdict(states, FAILED_STATES, RUNNING_OR_WAITING_STATES)]
}

export function mapCheckStatus(
  rollup: unknown,
  names: string[]
): 'pass' | 'fail' | 'warn' | 'unknown' {
  const states = checkStates(checksNamed(asRollup(rollup) ?? [], names), 'conclusion')
  return rollupVerdict(states, CHECK_FAILED_STATES, RUNNING_STATES)
}

function statusCheckState(raw: string): StatusCheck['state'] {
  if (raw === 'SUCCESS') return 'pass'
  if (FAILED_STATES.has(raw)) return 'fail'
  if (RUNNING_OR_WAITING_STATES.has(raw)) return 'pending'
  if (SKIPPED_STATES.has(raw)) return 'skipped'
  return 'unknown'
}

export function mapStatusChecks(rollup: unknown): StatusCheck[] {
  return (asRollup(rollup) ?? []).map((s) => ({
    name: String(s.name ?? s.context ?? 'Unknown check'),
    state: statusCheckState(upper(s.conclusion ?? s.state)),
    url: s.url ? String(s.url) : undefined,
  }))
}

function reviewLogin(r: RawRecord): string {
  return String(((r.user as RawRecord) ?? {}).login ?? '')
}

export function mapApprovals(
  reviews: Array<Record<string, unknown>>
): Array<{ author: string; authorAvatarUrl: string; submittedAt: string }> {
  // Each author's latest decisive review counts: a later CHANGES_REQUESTED dismisses an
  // earlier approval, while a later COMMENTED review does not.
  const byAuthor = new Map<string, RawRecord>()
  for (const r of reviews) {
    const login = reviewLogin(r)
    if (login && (!byAuthor.has(login) || upper(r.state) !== 'COMMENTED')) byAuthor.set(login, r)
  }
  return [...byAuthor.values()]
    .filter((r) => upper(r.state) === 'APPROVED')
    .map((r) => ({
      author: reviewLogin(r),
      authorAvatarUrl: String(((r.user as RawRecord) ?? {}).avatar_url ?? ''),
      submittedAt: String(r.submitted_at ?? ''),
    }))
}

/** The fields an issue comment and an inline comment share. */
function commentBase(obj: RawRecord) {
  const user = (firstOf(obj, ['user', 'author']) ?? {}) as RawRecord
  return {
    id: Number(obj.id),
    author: asText(user.login),
    authorAvatarUrl: asText(user.avatar_url),
    body: asText(obj.body),
    createdAt: asText(obj.created_at),
    updatedAt: asText(obj.updated_at),
  }
}

export function mapIssueComment(raw: unknown): IssueComment {
  return commentBase(raw as RawRecord)
}

function optionalNumber(value: unknown): number | null {
  if (value == null) return null
  return Number(value)
}

/** A reply joins its parent's thread; a top-level comment starts its own. */
function threadFields(id: number, inReplyTo: number | null) {
  const threadId = String(inReplyTo ?? id)
  return { threadId, isReply: inReplyTo != null, parentId: inReplyTo }
}

export function mapComment(raw: unknown): InlineComment {
  const obj = raw as RawRecord
  const base = commentBase(obj)
  const side: 'LEFT' | 'RIGHT' = upper(obj.side ?? 'RIGHT') === 'LEFT' ? 'LEFT' : 'RIGHT'
  return {
    ...base,
    path: String(obj.path ?? ''),
    line: Number(obj.line ?? 0),
    startLine: optionalNumber(obj.start_line),
    side,
    diffHunk: String(obj.diff_hunk ?? ''),
    outdated: Boolean(obj.outdated),
    ...threadFields(base.id, optionalNumber(obj.in_reply_to_id)),
  }
}

export function parsePrFileDiff(raw: string, filePath: string): FileDiff {
  return { ...parseDiff(raw, Infinity), path: filePath }
}
