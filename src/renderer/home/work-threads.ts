import type { ThreadFacet, WorkKey } from '../../shared/schemas/home-feed.schema'
import type { ChangeStats } from '../../shared/schemas/git.schema'
import type { IssueSummary } from '../../shared/types/index'
import type { Task } from '../../shared/schemas/tasks.schema'
import type { SessionFacts } from '../sidebar/session-facts'
import { planResume } from '../sidebar/resume'
import { groupIntoLanes, laneKeyOf, taskKeyOf, taskKeysByLane, type LaneDraft } from './task-lanes'
import {
  STATE_LABELS,
  TASK_STATES,
  laneStateOf,
  needsYouInferred,
  taskStateOf,
  type LaneFacts,
  type TaskState,
} from './task-state'

type Tone = ThreadFacet['tone']
type ThreadLink = NonNullable<ThreadFacet['links']>[number]

/** One repo and branch a thread touches. */
interface WorkThreadLane {
  repoRoot: string
  repoName: string
  repoColor: string | null
  branch: string
  state: TaskState
  /** The sessions running on this repo and branch. */
  sessionIds: string[]
}

export interface WorkThread {
  key: string
  title: string
  ticketKey?: string
  /** The stored task holding this thread, null for work that is one branch or one ticket. */
  taskId: string | null
  lanes: WorkThreadLane[]
  sessions: SessionFacts[]
  facets: ThreadFacet[]
  /** Where the thread's results are, from every facet, one per address. */
  links: ThreadLink[]
  state: TaskState
  /** The state is needs-you from a bell or a screen choice alone; draw it hollow. */
  inferred: boolean
  focus: boolean
  doneAt: string | null
  nowLine: string
  agentsLabel: string
  prChip: { text: string; tone: Tone } | null
  changes: ChangeStats | null
  lastActivity: number
  /** When the work began (epoch ms); it orders a list, because output never moves it. */
  startedAt: number
  /** Archived with its task, or parked by hand; it is left out of the lists. */
  archived: boolean
  /** Every facet is closed and no session is open: the work is over. */
  closed: boolean
}

export interface WorkThreadInput {
  facts: readonly SessionFacts[]
  facets: readonly ThreadFacet[]
  tasks: readonly Task[]
  issues: readonly IssueSummary[]
  /** Uncommitted change stats by project id. */
  changeStats: ReadonlyMap<string, ChangeStats>
  /** The repo's root folder by project id; a session's branch is only unique within it. */
  repoRoots: ReadonlyMap<string, string>
  /** Each repo's name and colour by its root folder, for a lane with no session to say them. */
  repos: ReadonlyMap<string, { name: string; color: string | null }>
  now: number
}

export interface ThreadGroup {
  id: TaskState
  label: string
  threads: WorkThread[]
}

/** Ticket keys read "<tracker>:<key>"; a repo key starts with a path. */
const TICKET_KEY = /^linear:/

/** One string per piece of work, so sessions, facets and issues can be joined on it. */
export function workKeyId(key: WorkKey): string {
  return 'tracker' in key ? `${key.tracker}:${key.key}` : laneKeyOf(key.repoRoot, key.branch)
}

interface Draft {
  key: string
  task: Task | null
  sessions: SessionFacts[]
  facets: ThreadFacet[]
}

/** A closed session has no live project, so its record's snapshot says where it ran. */
function projectIdOf(f: SessionFacts): string | null {
  if (!f.isClosed) return f.projectId
  return f.snapshot.projectId || null
}

/** Which ticket each repo branch belongs to, as the sessions on it say; project links win. */
function branchTickets(input: WorkThreadInput): Map<string, string> {
  const byBranch = new Map<string, string>()
  const ranked = [...input.facts].sort(
    (a, b) => Number(a.workItem?.source === 'project') - Number(b.workItem?.source === 'project')
  )
  for (const f of ranked) {
    const projectId = projectIdOf(f)
    const root = projectId ? input.repoRoots.get(projectId) : undefined
    if (f.workItem && root && f.branch) {
      byBranch.set(laneKeyOf(root, f.branch), workKeyId(f.workItem.ref))
    }
  }
  return byBranch
}

/** What a lane or a ticket joins to: the task holding the lane first, then the ticket. */
interface Joins {
  taskKeys: Map<string, string>
  tickets: Map<string, string>
}

function keyOfSession(f: SessionFacts, input: WorkThreadInput, joins: Joins) {
  const root = repoRootOf(f, input)
  const lane = root && f.branch ? laneKeyOf(root, f.branch) : null
  const task = lane ? joins.taskKeys.get(lane) : undefined
  if (task) return task
  if (f.workItem) return joinedKey(workKeyId(f.workItem.ref), joins)
  if (lane) return joinedKey(lane, joins)
  return `session:${f.sessionId}`
}

/** A lane or ticket key resolved through its branch's ticket and the task holding either. */
function joinedKey(own: string, joins: Joins): string {
  const ticket = joins.tickets.get(own) ?? own
  return joins.taskKeys.get(own) ?? joins.taskKeys.get(ticket) ?? ticket
}

function keyOfFacet(facet: ThreadFacet, joins: Joins): string {
  return joinedKey(workKeyId(facet.workKey), joins)
}

function draftFor(drafts: Map<string, Draft>, key: string): Draft {
  const found = drafts.get(key) ?? { key, task: null, sessions: [], facets: [] }
  drafts.set(key, found)
  return found
}

function repoRootOf(f: SessionFacts, input: WorkThreadInput): string | null {
  const projectId = projectIdOf(f)
  return projectId ? (input.repoRoots.get(projectId) ?? null) : null
}

/**
 * Open sessions first, then the ended ones a thread can still resume.
 * A closed scratch terminal belongs to no work, so it is left out.
 */
function sessionsToShow(facts: readonly SessionFacts[]): SessionFacts[] {
  const belongsToWork = (f: SessionFacts) => f.workItem !== null || projectIdOf(f) !== null
  return [
    ...facts.filter((f) => !f.isClosed),
    ...facts.filter((f) => f.isClosed && belongsToWork(f)),
  ]
}

function collectDrafts(input: WorkThreadInput): Draft[] {
  const joins = { taskKeys: taskKeysByLane(input.tasks), tickets: branchTickets(input) }
  const drafts = new Map<string, Draft>()
  for (const task of input.tasks) {
    drafts.set(taskKeyOf(task.id), { key: taskKeyOf(task.id), task, sessions: [], facets: [] })
  }
  for (const f of sessionsToShow(input.facts)) {
    draftFor(drafts, keyOfSession(f, input, joins)).sessions.push(f)
  }
  for (const facet of input.facets) draftFor(drafts, keyOfFacet(facet, joins)).facets.push(facet)
  return [...drafts.values()]
}

/** What the sessions are doing: the question one is asking, else what one is printing; empty when neither. */
export function sessionLineOf(sessions: readonly SessionFacts[]): string {
  const asking = sessions.find((s) => s.state === 'awaiting-input')
  if (asking) {
    return `Asking: ${asking.choicePrompt?.question ?? asking.askMessage ?? asking.latestLine}`
  }
  return sessions.find((s) => s.state === 'working' && s.latestLine !== '')?.latestLine ?? ''
}

function nowLineOf(draft: Draft): string {
  return sessionLineOf(draft.sessions) || (mainFacet(draft)?.line ?? '')
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
    draft.task?.title,
    issue?.title,
    facets.find((f) => f.title)?.title,
    firstLine(sessions.find((s) => s.description)?.description),
    sessions.find((s) => s.branch)?.branch,
    sessions[0]?.projectName,
    sessions.find((s) => s.name)?.name,
  ]
  return candidates.find((c) => c) ?? draft.key
}

/** When a stored task was made; a task with no session or facet yet is dated by it. */
const createdAtOf = (draft: Draft): number[] =>
  draft.task ? [Date.parse(draft.task.createdAt)] : []

function lastActivityOf(draft: Draft): number {
  const times = [
    ...draft.sessions.map((s) => s.lastActivityAt),
    ...draft.facets.map((f) => Date.parse(f.updatedAt)),
  ]
  return Math.max(0, ...(times.length > 0 ? times : createdAtOf(draft)))
}

function startedAtOf(draft: Draft): number {
  const times = [
    ...draft.sessions.map((s) => Date.parse(s.startedAt)),
    ...draft.facets.map((f) => Date.parse(f.openedAt ?? f.updatedAt)),
  ]
  return Math.min(...(times.length > 0 ? times : createdAtOf(draft)))
}

function isClosedDraft(draft: Draft): boolean {
  return (
    draft.sessions.every((s) => s.isClosed) &&
    draft.facets.length > 0 &&
    draft.facets.every((f) => f.closedAt !== null)
  )
}

/** The repo's name and colour: from a session on the lane, else the workspace at its root. */
function repoLabelOf(lane: LaneDraft, input: WorkThreadInput) {
  const session = lane.sessions[0]
  if (session?.workspaceName) {
    return { repoName: session.workspaceName, repoColor: session.workspaceColor }
  }
  const repo = input.repos.get(lane.repoRoot)
  if (repo) return { repoName: repo.name, repoColor: repo.color }
  return { repoName: lane.repoRoot.split('/').pop() || lane.repoRoot, repoColor: null }
}

function repoLaneOf(lane: LaneDraft, input: WorkThreadInput): WorkThreadLane {
  return {
    repoRoot: lane.repoRoot,
    ...repoLabelOf(lane, input),
    branch: lane.branch,
    state: laneStateOf(lane),
    sessionIds: lane.sessions.map((session) => session.sessionId),
  }
}

function ticketKeyOf(draft: Draft): { ticketKey: string } | Record<string, never> {
  if (TICKET_KEY.test(draft.key)) return { ticketKey: draft.key.replace(TICKET_KEY, '') }
  return draft.task?.ticket ? { ticketKey: draft.task.ticket.key } : {}
}

/** Where the work is: its title, ticket, repos and branches. */
function identityOf(draft: Draft, lanes: readonly LaneDraft[], input: WorkThreadInput) {
  const issue = input.issues.find((i) => workKeyId(i) === draft.key)
  const lead = draft.sessions[0]
  return {
    key: draft.key,
    title: titleOf(draft, issue),
    ...ticketKeyOf(draft),
    taskId: draft.task?.id ?? null,
    lanes: lanes.map((lane) => repoLaneOf(lane, input)),
    changes: input.changeStats.get(lead?.projectId ?? '') ?? null,
  }
}

/** What is happening on it and what state it is in. */
function statusOf(draft: Draft, laneFacts: readonly LaneFacts[]) {
  const pr = draft.facets.find((f) => f.kind === 'pull-request')
  const doneAt = draft.task?.doneAt ?? null
  return {
    state: taskStateOf(laneFacts, doneAt),
    inferred: needsYouInferred(laneFacts),
    focus: draft.task?.focus ?? false,
    doneAt,
    nowLine: nowLineOf(draft),
    agentsLabel: agentsLabelOf(draft.sessions),
    prChip: pr ? { text: pr.line, tone: pr.tone } : null,
    lastActivity: lastActivityOf(draft),
    startedAt: startedAtOf(draft),
    archived: draft.task?.archivedAt != null,
    closed: isClosedDraft(draft),
  }
}

function linksOf(facets: readonly ThreadFacet[]): ThreadLink[] {
  const byUrl = new Map<string, ThreadLink>()
  for (const link of facets.flatMap((f) => f.links ?? [])) {
    if (!byUrl.has(link.url)) byUrl.set(link.url, link)
  }
  return [...byUrl.values()]
}

function toThread(draft: Draft, input: WorkThreadInput): WorkThread {
  const { lanes, loose } = groupIntoLanes(draft, draft.task?.lanes ?? [], (s) =>
    repoRootOf(s, input)
  )
  const hasLoose = loose.sessions.length + loose.facets.length > 0
  return {
    ...identityOf(draft, lanes, input),
    ...statusOf(draft, hasLoose ? [...lanes, loose] : lanes),
    sessions: draft.sessions,
    facets: draft.facets,
    links: linksOf(draft.facets),
  }
}

/** Every thread, including finished ones; a Focus item reads a shipped thread from here. */
export function allWorkThreads(input: WorkThreadInput): WorkThread[] {
  return collectDrafts(input).map((draft) => toThread(draft, input))
}

/** The thread holding the conversation that ended most recently and can still be resumed. */
export function latestResumableThread(threads: readonly WorkThread[]): WorkThread | undefined {
  const endedAt = (thread: WorkThread) =>
    Math.max(
      0,
      ...thread.sessions.filter((s) => planResume(s) !== null).map((s) => s.lastActivityAt)
    )
  return threads.filter((thread) => endedAt(thread) > 0).sort((a, b) => endedAt(b) - endedAt(a))[0]
}

/** The threads worth showing: work with an open session or a facet still open. */
export function buildWorkThreads(input: WorkThreadInput): WorkThread[] {
  return allWorkThreads(input).filter((t) => !t.closed || t.taskId !== null)
}

/** The focused task first, then newest work first; a row never moves because its terminal printed. */
export function focusFirst(a: WorkThread, b: WorkThread): number {
  return (
    Number(b.focus) - Number(a.focus) || b.startedAt - a.startedAt || a.key.localeCompare(b.key)
  )
}

/** The lists Home shows, one per state in focus order; archived threads are left out. */
export function groupThreads(threads: readonly WorkThread[]): ThreadGroup[] {
  const shown = threads.filter((t) => !t.archived)
  return TASK_STATES.map((id) => ({
    id,
    label: STATE_LABELS[id],
    threads: shown.filter((t) => t.state === id).sort(focusFirst),
  })).filter((group) => group.threads.length > 0)
}
