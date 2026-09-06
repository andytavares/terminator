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

export type TransitionIntent = 'started' | 'in_review' | 'done'

export interface TrackerStateOption {
  readonly id: string
  readonly name: string
  readonly intent: TransitionIntent | null
  readonly available: boolean
}

/** The slice of `ExtensionAPI.issues` this needs. Nothing else is reachable. */
export interface IssuesPort {
  comment(tracker: string, key: string, body: string): Promise<void>
  transition(
    tracker: string,
    key: string,
    intent: TransitionIntent,
    optionId?: string
  ): Promise<void>
  states(tracker: string, key: string): Promise<TrackerStateOption[]>
  supportsTransitions(tracker: string): boolean
}

export type WriteBackEvent = 'agreed' | 'amended' | 'started' | 'draft_opened' | 'merged'

/** What each moment in an order's life means in the tracker's own terms. */
export const INTENT_FOR_EVENT: Record<WriteBackEvent, TransitionIntent | null> = {
  agreed: null,
  amended: null,
  started: 'started',
  draft_opened: 'in_review',
  merged: 'done',
}

/** One retry. A tracker refusing twice is a tracker with a problem. */
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

function sourceIssue(order: WorkOrder): { tracker: string; key: string } | null {
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
  let states: TrackerStateOption[] = []
  try {
    states = [...(await deps.issues.states(issue.tracker, issue.key))]
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

/**
 * Do one write, retrying a failure and never retrying an unsupported one.
 *
 * Nothing here throws. The caller is the Line, and the Line must not care.
 */
async function attempt(
  write: WriteBackResult['write'],
  subject: string,
  work: () => Promise<void>,
  deps: WriteBackDeps
): Promise<WriteBackResult> {
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    try {
      await work()
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

export interface WriteBackPayload {
  /** The drafts just opened. Only meaningful for `draft_opened`. */
  readonly pulls?: readonly { repo: string; url: string }[]
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
  event: WriteBackEvent,
  deps: WriteBackDeps,
  payload: WriteBackPayload = {}
): Promise<WriteBackResult[]> {
  const issue = sourceIssue(order)
  if (issue === null) return []

  const enabled = new Set(order.writeBack)
  const results: WriteBackResult[] = []

  if (enabled.has('summary_comment') && (event === 'agreed' || event === 'amended')) {
    results.push(
      await attempt(
        'summary_comment',
        issue.key,
        () => deps.issues.comment(issue.tracker, issue.key, renderOrder(order)),
        deps
      )
    )
  }

  const intent = INTENT_FOR_EVENT[event]
  if (enabled.has('status') && intent !== null) {
    if (!deps.issues.supportsTransitions(issue.tracker)) {
      // Never emulated. A tracker that cannot move an issue does not get a
      // comment saying it moved.
      const reason = `${issue.tracker} cannot be asked to move ${issue.key}, so "${intent}" was not written.`
      await deps.record('writeback.unsupported', issue.key, reason)
      results.push({ write: 'status', ok: false, unsupported: true, reason })
    } else {
      results.push(
        await attempt(
          'status',
          issue.key,
          () => deps.issues.transition(issue.tracker, issue.key, intent, deps.mapping?.[intent]),
          deps
        )
      )
    }
  }

  const pulls = payload.pulls ?? []
  if (enabled.has('pr_link') && event === 'draft_opened' && pulls.length > 0) {
    results.push(
      await attempt(
        'pr_link',
        issue.key,
        () => deps.issues.comment(issue.tracker, issue.key, linkComment(order, pulls)),
        deps
      )
    )
  }

  return results
}
