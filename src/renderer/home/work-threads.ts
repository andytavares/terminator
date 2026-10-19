import type { ThreadFacet, WorkKey } from '../../shared/schemas/home-feed.schema'
import type { ChangeStats } from '../../shared/schemas/git.schema'
import type { IssueSummary } from '../../shared/types/index'
import type { SessionFacts } from '../sidebar/session-facts'

type Stage = ThreadFacet['stage']
type WhoseMove = ThreadFacet['whoseMove']
type Tone = ThreadFacet['tone']

export interface WorkThread {
  key: string
  title: string
  ticketKey?: string
  repoName: string | null
  repoColor: string | null
  branch: string | null
  sessions: SessionFacts[]
  facets: ThreadFacet[]
  stage: Stage
  whoseMove: WhoseMove
  nowLine: string
  agentsLabel: string
  prChip: { text: string; tone: Tone } | null
  changes: ChangeStats | null
  lastActivity: number
  parked: boolean
  /** Every facet is closed and no session is open: the work is over. */
  closed: boolean
}

export interface WorkThreadInput {
  facts: readonly SessionFacts[]
  facets: readonly ThreadFacet[]
  issues: readonly IssueSummary[]
  /** Uncommitted change stats by project id. */
  changeStats: ReadonlyMap<string, ChangeStats>
  /** The repo's root folder by project id; a session's branch is only unique within it. */
  repoRoots: ReadonlyMap<string, string>
  now: number
}

export interface ThreadGroup {
  id: 'agents' | 'others' | 'parked'
  label: string
  threads: WorkThread[]
}

const STAGES: readonly Stage[] = ['shaping', 'building', 'in-review', 'merging', 'shipped']
/** Ticket keys read "<tracker>:<key>"; a repo key starts with a path. */
const TICKET_KEY = /^(linear|jira):/
const PARKED_AFTER_MS = 48 * 60 * 60 * 1000

/** One string per piece of work, so sessions, facets and issues can be joined on it. */
export function workKeyId(key: WorkKey): string {
  return 'tracker' in key ? `${key.tracker}:${key.key}` : `${key.repoRoot}#${key.branch}`
}

interface Draft {
  key: string
  repoRoot: string | null
  sessions: SessionFacts[]
  facets: ThreadFacet[]
}

function repoKey(repoRoot: string, branch: string): string {
  return workKeyId({ repoRoot, branch })
}

/** Which ticket each repo branch belongs to, as the sessions on it say; project links win. */
function branchTickets(input: WorkThreadInput): Map<string, string> {
  const byBranch = new Map<string, string>()
  const ranked = [...input.facts].sort(
    (a, b) => Number(a.workItem?.source === 'project') - Number(b.workItem?.source === 'project')
  )
  for (const f of ranked) {
    const root = f.projectId ? input.repoRoots.get(f.projectId) : undefined
    if (f.workItem && root && f.branch) {
      byBranch.set(repoKey(root, f.branch), workKeyId(f.workItem.ref))
    }
  }
  return byBranch
}

function keyOfSession(f: SessionFacts, input: WorkThreadInput, tickets: Map<string, string>) {
  const root = f.projectId ? input.repoRoots.get(f.projectId) : undefined
  if (f.workItem) return workKeyId(f.workItem.ref)
  if (root && f.branch) return tickets.get(repoKey(root, f.branch)) ?? repoKey(root, f.branch)
  return `session:${f.sessionId}`
}

function keyOfFacet(facet: ThreadFacet, tickets: Map<string, string>): string {
  const own = workKeyId(facet.workKey)
  return tickets.get(own) ?? own
}

function draftFor(drafts: Map<string, Draft>, key: string): Draft {
  const found = drafts.get(key) ?? { key, repoRoot: null, sessions: [], facets: [] }
  drafts.set(key, found)
  return found
}

function repoRootOf(f: SessionFacts, input: WorkThreadInput): string | null {
  return f.projectId ? (input.repoRoots.get(f.projectId) ?? null) : null
}

function attachSessionToDraft(draft: Draft, f: SessionFacts, repoRoot: string | null) {
  draft.sessions.push(f)
  draft.repoRoot ??= repoRoot
}

function attachFacetToDraft(draft: Draft, facet: ThreadFacet) {
  draft.facets.push(facet)
  if ('repoRoot' in facet.workKey) draft.repoRoot ??= facet.workKey.repoRoot
}

function collectDrafts(input: WorkThreadInput): Draft[] {
  const tickets = branchTickets(input)
  const drafts = new Map<string, Draft>()
  for (const f of input.facts.filter((s) => !s.isClosed)) {
    attachSessionToDraft(draftFor(drafts, keyOfSession(f, input, tickets)), f, repoRootOf(f, input))
  }
  for (const facet of input.facets)
    attachFacetToDraft(draftFor(drafts, keyOfFacet(facet, tickets)), facet)
  return [...drafts.values()]
}

function furthestStage(draft: Draft): Stage {
  const shaping = draft.facets.some((f) => f.kind === 'order' && f.stage === 'shaping')
  const furthest = draft.facets.reduce<Stage>(
    (best, f) => (STAGES.indexOf(f.stage) > STAGES.indexOf(best) ? f.stage : best),
    'shaping'
  )
  if (shaping || furthest !== 'shaping') return furthest
  return 'building'
}

function whoseMoveOf(draft: Draft): WhoseMove {
  const { sessions, facets } = draft
  if (
    sessions.some((s) => s.state === 'awaiting-input') ||
    facets.some((f) => f.whoseMove === 'you')
  ) {
    return 'you'
  }
  if (sessions.some((s) => s.state === 'working')) return 'agents'
  return 'others'
}

function nowLineOf(draft: Draft): string {
  const asking = draft.sessions.find((s) => s.state === 'awaiting-input')
  if (asking) {
    return `Asking: ${asking.choicePrompt?.question ?? asking.askMessage ?? asking.latestLine}`
  }
  const working = draft.sessions.find((s) => s.state === 'working' && s.latestLine !== '')
  return working?.latestLine ?? mainFacet(draft)?.line ?? ''
}

function mainFacet(draft: Draft): ThreadFacet | undefined {
  return draft.facets.find((f) => f.kind === 'pull-request') ?? draft.facets[0]
}

const AGENT_STATE_WORDS: ReadonlyArray<readonly [SessionFacts['state'], string]> = [
  ['working', 'working'],
  ['awaiting-input', 'asking'],
  ['idle', 'idle'],
]

function countSessionsIn(sessions: readonly SessionFacts[], state: SessionFacts['state']): number {
  return sessions.filter((s) => s.state === state).length
}

function agentsLabelOf(sessions: readonly SessionFacts[]): string {
  const said = AGENT_STATE_WORDS.map(
    ([state, word]) => `${countSessionsIn(sessions, state)} ${word}`
  ).filter((part) => !part.startsWith('0 '))
  return said.length > 0 ? said.join(', ') : 'none'
}

function firstLine(text: string | null | undefined): string | undefined {
  return text?.split('\n')[0]
}

function titleOf(draft: Draft, issue: IssueSummary | undefined): string {
  const { sessions, facets } = draft
  const candidates = [
    issue?.title,
    facets.find((f) => f.title)?.title,
    firstLine(sessions.find((s) => s.description)?.description),
    sessions.find((s) => s.branch)?.branch,
    sessions[0]?.projectName,
  ]
  return candidates.find((c) => c) ?? draft.key
}

function lastActivityOf(draft: Draft): number {
  return Math.max(
    0,
    ...draft.sessions.map((s) => s.lastActivityAt),
    ...draft.facets.map((f) => Date.parse(f.updatedAt))
  )
}

function isParked(draft: Draft, lastActivity: number, now: number): boolean {
  const scratch = draft.facets.length === 0 && draft.sessions.every((s) => s.projectId === null)
  return scratch || now - lastActivity > PARKED_AFTER_MS
}

function isClosedDraft(draft: Draft): boolean {
  return (
    draft.sessions.length === 0 &&
    draft.facets.length > 0 &&
    draft.facets.every((f) => f.closedAt !== null)
  )
}

function repoNameOf(draft: Draft): string | null {
  const root = draft.repoRoot?.split('/').pop()
  return draft.sessions[0]?.workspaceName ?? root ?? null
}

/** Where the work is: its title, repo and branch. */
function identityOf(draft: Draft, input: WorkThreadInput) {
  const issue = input.issues.find((i) => workKeyId(i) === draft.key)
  const lead = draft.sessions[0]
  return {
    key: draft.key,
    title: titleOf(draft, issue),
    ...(TICKET_KEY.test(draft.key) ? { ticketKey: draft.key.replace(TICKET_KEY, '') } : {}),
    repoName: repoNameOf(draft),
    repoColor: lead?.workspaceColor ?? null,
    branch: lead?.branch ?? workBranch(draft),
    changes: input.changeStats.get(lead?.projectId ?? '') ?? null,
  }
}

/** What is happening on it and whose move it is. */
function statusOf(draft: Draft, now: number) {
  const pr = draft.facets.find((f) => f.kind === 'pull-request')
  const lastActivity = lastActivityOf(draft)
  return {
    stage: furthestStage(draft),
    whoseMove: whoseMoveOf(draft),
    nowLine: nowLineOf(draft),
    agentsLabel: agentsLabelOf(draft.sessions),
    prChip: pr ? { text: pr.line, tone: pr.tone } : null,
    lastActivity,
    parked: isParked(draft, lastActivity, now),
    closed: isClosedDraft(draft),
  }
}

function toThread(draft: Draft, input: WorkThreadInput): WorkThread {
  return {
    ...identityOf(draft, input),
    ...statusOf(draft, input.now),
    sessions: draft.sessions,
    facets: draft.facets,
  }
}

function workBranch(draft: Draft): string | null {
  const key = draft.facets.map((f) => f.workKey).find((k) => 'branch' in k)
  return key && 'branch' in key ? key.branch : null
}

/** Every thread, including finished ones; a Focus item reads a shipped thread from here. */
export function allWorkThreads(input: WorkThreadInput): WorkThread[] {
  return collectDrafts(input).map((draft) => toThread(draft, input))
}

/** The threads worth showing: work with an open session or a facet still open. */
export function buildWorkThreads(input: WorkThreadInput): WorkThread[] {
  return allWorkThreads(input).filter((t) => !t.closed)
}

const GROUP_LABELS: Record<ThreadGroup['id'], string> = {
  agents: 'Agents working',
  others: 'Waiting on others',
  parked: 'Parked',
}

function threadGroupOf(thread: WorkThread): ThreadGroup['id'] {
  if (thread.parked) return 'parked'
  return thread.whoseMove === 'others' ? 'others' : 'agents'
}

function yourMoveFirst(a: WorkThread, b: WorkThread): number {
  return (
    Number(b.whoseMove === 'you') - Number(a.whoseMove === 'you') || b.lastActivity - a.lastActivity
  )
}

/** The Desk's three lists; threads waiting on you sit at the top of "Agents working". */
export function groupThreads(threads: readonly WorkThread[]): ThreadGroup[] {
  return (Object.keys(GROUP_LABELS) as ThreadGroup['id'][])
    .map((id) => ({
      id,
      label: GROUP_LABELS[id],
      threads: threads.filter((t) => threadGroupOf(t) === id).sort(yourMoveFirst),
    }))
    .filter((group) => group.threads.length > 0)
}
