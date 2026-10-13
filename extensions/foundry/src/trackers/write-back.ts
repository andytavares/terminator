import { renderOrder } from '../order/render.js'
import type { WorkOrder } from '../order/schema.js'

// Back to the issue the work came from.
//
// Three writes — the agreed order as a comment, the workflow state, the pull
// request links — and one rule over all of them: a tracker write never affects
// the work (FR-063). The board being briefly wrong is a nuisance; a completed
// change thrown away because a comment failed is a disaster.
//
// The distinction this file turns on is *failed* against *unsupported*. A
// failure is retried. A capability the tracker does not have is recorded once,
// at agreement, and never asked about again — retrying it forever is how a
// record becomes unreadable, and telling the operator at write time is telling
// them too late to do anything about it.

/** @internal */
export type TransitionIntent = 'started' | 'in_review' | 'done'

interface TrackerStateOption {
  readonly id: string
  readonly name: string
  readonly intent: TransitionIntent | null
  readonly available: boolean
}

/** The slice of `ExtensionAPI.issues` this needs. Nothing else is reachable. */
/** One issue, on one tracker. */
interface IssueRef {
  readonly tracker: string
  readonly key: string
}

export interface IssuesPort {
  comment(issue: IssueRef, body: string): Promise<void>
  transition(issue: IssueRef, intent: TransitionIntent, optionId?: string): Promise<void>
  states(issue: IssueRef): Promise<TrackerStateOption[]>
  supportsTransitions(tracker: string): boolean
}

export type WriteBackEvent = 'agreed' | 'amended' | 'started' | 'draft_opened' | 'merged'

/**
 * What each moment in an order's life means in the tracker's own terms.
 * @internal
 */
export const INTENT_FOR_EVENT: Record<WriteBackEvent, TransitionIntent | null> = {
  agreed: null,
  amended: null,
  started: 'started',
  draft_opened: 'in_review',
  merged: 'done',
}

const STATE_WORDS: Record<TransitionIntent, string> = {
  started: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
}

/**
 * A team with a single "started" state has nowhere to put a review. Core says
 * so with "No available … satisfies"; the operator needs to hear what that
 * means for the ticket.
 */
function withNoReviewState(error: unknown, key: string): unknown {
  if (!/No available .* satisfies/.test(messageOf(error))) return error
  return new Error(
    `${key} stays In Progress because the team has no review state (${messageOf(error)})`
  )
}

/**
 * One retry. A tracker refusing twice is a tracker with a problem.
 * @internal
 */
export const MAX_ATTEMPTS = 2

export interface WriteBackDeps {
  readonly issues: IssuesPort
  readonly record: (action: string, subject: string, reason: string) => Promise<void>
  readonly now: () => string
  /**
   * The operator's own intent-to-state mapping (FR-060).
   *
   * Stored by Foundry rather than by core, because which of *their* states
   * means "in review" is their decision, not the tracker's and not ours.
   */
  readonly mapping?: Partial<Record<TransitionIntent, string>>
}

export interface WriteBackResult {
  readonly write: 'summary_comment' | 'status' | 'pr_link'
  readonly ok: boolean
  /** True when the tracker cannot do this at all. Not a failure; not retried. */
  readonly unsupported: boolean
  readonly reason: string
}

export interface CapabilityReport {
  /** `no_issue` when the order was typed rather than seeded from a tracker. */
  readonly transitions: 'supported' | 'unsupported' | 'no_issue'
  /** The candidates the operator adjusts the mapping against. */
  readonly states: readonly TrackerStateOption[]
  /** Intents this workflow has nowhere to go for. Normal, and worth saying. */
  readonly unreachable: readonly TransitionIntent[]
}

const INTENTS: readonly TransitionIntent[] = ['started', 'in_review', 'done']

function sourceIssue(order: WorkOrder): IssueRef | null {
  const { tracker, key } = order.source
  if (tracker === null || key === null || key === '') return null
  return { tracker, key }
}

function isUnsupported(error: unknown): boolean {
  return (error as { kind?: unknown } | null)?.kind === 'unsupported'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Ask what this tracker can do, at the moment the order is agreed.
 *
 * FR-059a, and the reason it is a requirement of its own: an order whose issue
 * will never move is something the operator should know before the run, not
 * discover in the ledger afterwards.
 */
export async function checkCapability(
  order: WorkOrder,
  deps: WriteBackDeps
): Promise<CapabilityReport> {
  const issue = sourceIssue(order)
  if (issue === null) return { transitions: 'no_issue', states: [], unreachable: [] }

  if (!deps.issues.supportsTransitions(issue.tracker)) {
    await deps.record(
      'writeback.unsupported',
      issue.tracker,
      `${issue.tracker} cannot be asked to move an issue, so this order will not move ${issue.key}'s state. Comments and pull request links still work.`
    )
    return { transitions: 'unsupported', states: [], unreachable: [...INTENTS] }
  }

  // A tracker that is momentarily unreachable is not a tracker without the
  // capability. Agreement must not fail on it, and the operator can still set
  // the mapping later.
  let states: TrackerStateOption[]
  try {
    states = [...(await deps.issues.states(issue))]
  } catch {
    states = []
  }

  const reachable = new Set(states.filter((s) => s.available).map((s) => s.intent))
  return {
    transitions: 'supported',
    states,
    unreachable: states.length === 0 ? [] : INTENTS.filter((intent) => !reachable.has(intent)),
  }
}

/** One write to the tracker: which, about what, and what to record once it is done. */
interface Write {
  readonly write: WriteBackResult['write']
  readonly subject: string
  readonly done: string
}

/**
 * Do one write, retrying a failure and never retrying an unsupported one.
 *
 * Nothing here throws. The caller is the Line, and the Line must not care.
 */
async function attempt(
  { write, subject, done }: Write,
  work: () => Promise<void>,
  deps: WriteBackDeps
): Promise<WriteBackResult> {
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    try {
      await work()
      await deps.record('writeback.ok', subject, done)
      return { write, ok: true, unsupported: false, reason: '' }
    } catch (error) {
      if (isUnsupported(error)) {
        const reason = messageOf(error)
        await deps.record('writeback.unsupported', subject, reason)
        return { write, ok: false, unsupported: true, reason }
      }
      if (n === MAX_ATTEMPTS) {
        const reason = `${write} on ${subject} failed after ${MAX_ATTEMPTS} attempts: ${messageOf(error)}`
        await deps.record('writeback.failed', subject, reason)
        return { write, ok: false, unsupported: false, reason }
      }
    }
  }
  /* c8 ignore next */
  return { write, ok: false, unsupported: false, reason: 'unreachable' }
}

function linkComment(order: WorkOrder, pulls: readonly { repo: string; url: string }[]): string {
  const lines = [
    `Foundry opened ${pulls.length === 1 ? 'a draft' : 'drafts'} for \`${order.id}\`:`,
    '',
  ]
  for (const pull of pulls) lines.push(`- **${pull.repo}** — ${pull.url}`)
  return lines.join('\n')
}

/** A moment in an order's life worth telling the tracker about. */
export interface WriteBackMoment {
  readonly event: WriteBackEvent
  /** The drafts just opened. Only meaningful for `draft_opened`. */
  readonly pulls?: readonly { repo: string; url: string }[]
}

/** Everything one write-back reads: the order, its issue, the moment, and the tracker. */
interface WriteBackRun {
  readonly order: WorkOrder
  readonly issue: IssueRef
  readonly moment: WriteBackMoment
  readonly deps: WriteBackDeps
}

/**
 * Write whatever this moment calls for, to whatever the order has turned on.
 *
 * Returns what happened for each write rather than throwing, and the caller
 * carries on regardless — that is FR-063 expressed in the signature rather
 * than asked for in a comment.
 */
export async function writeBack(
  order: WorkOrder,
  moment: WriteBackMoment,
  deps: WriteBackDeps
): Promise<WriteBackResult[]> {
  const issue = sourceIssue(order)
  if (issue === null) return []
  const run: WriteBackRun = { order, issue, moment, deps }
  const results: WriteBackResult[] = []
  for (const write of [summaryComment, statusMove, prLink]) {
    const result = await write(run)
    if (result !== null) results.push(result)
  }
  return results
}

async function summaryComment(run: WriteBackRun): Promise<WriteBackResult | null> {
  const { order, issue, moment, deps } = run
  if (!order.writeBack.includes('summary_comment')) return null
  if (moment.event !== 'agreed' && moment.event !== 'amended') return null
  return attempt(
    {
      write: 'summary_comment',
      subject: issue.key,
      done: `the agreed order was commented on ${issue.key}`,
    },
    () => deps.issues.comment(issue, renderOrder(order)),
    deps
  )
}

async function statusMove(run: WriteBackRun): Promise<WriteBackResult | null> {
  const { order, issue, moment, deps } = run
  const intent = INTENT_FOR_EVENT[moment.event]
  if (!order.writeBack.includes('status') || intent === null) return null
  if (!deps.issues.supportsTransitions(issue.tracker)) {
    // Never emulated. A tracker that cannot move an issue does not get a
    // comment saying it moved.
    const reason = `${issue.tracker} cannot be asked to move ${issue.key}, so "${intent}" was not written.`
    await deps.record('writeback.unsupported', issue.key, reason)
    return { write: 'status', ok: false, unsupported: true, reason }
  }
  return attempt(
    { write: 'status', subject: issue.key, done: `${issue.key} moved to ${STATE_WORDS[intent]}` },
    () => moveIssue(run, intent),
    deps
  )
}

async function moveIssue({ issue, deps }: WriteBackRun, intent: TransitionIntent): Promise<void> {
  const optionId = deps.mapping?.[intent]
  try {
    await deps.issues.transition(issue, intent, optionId)
  } catch (error) {
    throw intent === 'in_review' && optionId === undefined
      ? withNoReviewState(error, issue.key)
      : error
  }
}

async function prLink(run: WriteBackRun): Promise<WriteBackResult | null> {
  const { order, issue, moment, deps } = run
  const pulls = moment.pulls ?? []
  if (!order.writeBack.includes('pr_link') || moment.event !== 'draft_opened') return null
  if (pulls.length === 0) return null
  return attempt(
    {
      write: 'pr_link',
      subject: issue.key,
      done: `${pulls.length} pull request link${pulls.length === 1 ? '' : 's'} commented on ${issue.key}`,
    },
    () => deps.issues.comment(issue, linkComment(order, pulls)),
    deps
  )
}
