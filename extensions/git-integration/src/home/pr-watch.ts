import type { DashboardCheck, DashboardPR } from '../schemas/pr-review.schema.js'

// The pure part of the pull request watch (ADR 142): what changed between two dashboards, which
// comments are new, and the words sent to the agent. Nothing here reads GitHub or starts an agent.

/** A pull request wakes its agent at most this many times. */
export const WAKE_LIMIT = 10

const LOG_TAIL_LINES = 40

/** A review or comment on a pull request. */
export interface WatchComment {
  author: string
  body: string
  createdAt: string
}

export type WatchEvent =
  | { kind: 'check-failed'; checks: DashboardCheck[]; logs: Record<string, string> }
  | { kind: 'comments'; comments: WatchComment[] }
  | { kind: 'conflict' }

/** What the watch keeps for one pull request, in the `pr-watch` store. */
export interface PrWatchState {
  /** Comments made after this time are new. */
  seenAt: string
  wakes: number
  /** An agent was resumed, or one the watch woke has ended: the watch resumes no other. */
  resumeUsed: boolean
  /** The wake limit was reached. */
  stopped: boolean
}

/** What the watch reads from GitHub; the GitHub handlers supply it. */
export interface PrWatchReads {
  viewer(): Promise<string>
  comments(pr: DashboardPR): Promise<WatchComment[]>
  /** The log of the job behind a failed check, or '' when it has none. */
  failedLog(pr: DashboardPR, check: DashboardCheck): Promise<string>
}

/** A pull request of mine in two dashboards. */
export interface PrChange {
  previous: DashboardPR
  current: DashboardPR
}

const sameNumber = (a: DashboardPR) => (b: DashboardPR) =>
  a.repo === b.repo && a.number === b.number
const mine = (prs: DashboardPR[]) => prs.filter((pr) => pr.section === 'mine')

/** My pull requests present in both dashboards. */
export function changesOf(previous: DashboardPR[], current: DashboardPR[]): PrChange[] {
  return mine(current).flatMap((pr) => {
    const before = mine(previous).find(sameNumber(pr))
    return before ? [{ previous: before, current: pr }] : []
  })
}

/** My pull requests in the old dashboard and not in the new: merged or closed. */
export function endedWatches(previous: DashboardPR[], current: DashboardPR[]): DashboardPR[] {
  return mine(previous).filter((pr) => !mine(current).some(sameNumber(pr)))
}

/** Checks failed now that were not failed in the earlier dashboard. */
export function newlyFailed({ previous, current }: PrChange): DashboardCheck[] {
  const failedBefore = new Set(
    (previous.checks ?? []).filter((c) => c.state === 'failed').map((c) => c.name)
  )
  return (current.checks ?? []).filter((c) => c.state === 'failed' && !failedBefore.has(c.name))
}

export function becameConflicting({ previous, current }: PrChange): boolean {
  return current.mergeStateStatus === 'dirty' && previous.mergeStateStatus !== 'dirty'
}

/** Comments by someone other than me, made after `seenAt`. */
export function newComments(all: WatchComment[], seen: { seenAt: string; me: string }) {
  return all.filter((c) => c.author !== seen.me && c.createdAt > seen.seenAt)
}

/** The latest comment time, else `seenAt`. */
export function latestSeen(all: WatchComment[], seenAt: string): string {
  return all.reduce((latest, c) => (c.createdAt > latest ? c.createdAt : latest), seenAt)
}

export function tailLines(text: string, count = LOG_TAIL_LINES): string {
  return text.trimEnd().split('\n').slice(-count).join('\n')
}

function textOf(event: WatchEvent): string {
  if (event.kind === 'conflict')
    return 'The branch now conflicts with its base. Merge or rebase it and push.'
  if (event.kind === 'comments') {
    return event.comments.map((c) => `${c.author} wrote:\n${c.body}`).join('\n\n')
  }
  return event.checks
    .map(
      (c) => `The check "${c.name}" failed. End of its log:\n${tailLines(event.logs[c.name] ?? '')}`
    )
    .join('\n\n')
}

/** The prompt: a first line that marks it as automatic, then one paragraph per event. */
export function wakeMessage(pr: DashboardPR, wake: number, events: WatchEvent[]): string {
  const header = `Sent by Terminator · pull request #${pr.number} · wake ${wake} of ${WAKE_LIMIT}`
  return [header, ...events.map(textOf)].join('\n\n')
}

const SUMMARIES = {
  'check-failed': (e: Extract<WatchEvent, { kind: 'check-failed' }>) =>
    `Check failed: ${e.checks.map((c) => c.name).join(', ')}`,
  comments: (e: Extract<WatchEvent, { kind: 'comments' }>) =>
    `New comment from ${[...new Set(e.comments.map((c) => c.author))].join(', ')}`,
  conflict: () => 'Merge conflict with the base branch',
}

/** One line for Home: what happened. */
export function summaryOf(events: WatchEvent[]): string {
  return events
    .map((event) => (SUMMARIES[event.kind] as (e: WatchEvent) => string)(event))
    .join(' · ')
}

/** A trace on Home: the agent was woken, or the wakes stopped. */
export interface WatchNote {
  kind: 'woken' | 'stopped'
  pr: DashboardPR
  summary: string
  wake: number
  since: string
}
