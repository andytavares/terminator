import { laterOverlapping } from './refinery.js'
import type { QueueEntry } from './refinery.js'
import type { RefineryState } from './refinery-state.js'
import type { RestackResult } from './restack.js'

// The refinery running: watch for merges, restack what queued behind, recheck
// it.
//
// Nothing here talks to git, `gh` or a gate store directly — every externality
// is a `deps` function, so the four outcomes a restack can have (nothing to
// do, rebased and re-checked, conflict, or a transient failure) are each one
// assertion against a fake, not a real checkout.

interface RefineryCandidate {
  readonly order: { readonly id: string; readonly title: string }
  /** The pulls this order has opened. Empty means nothing to watch yet. */
  readonly pulls: readonly { readonly url: string }[]
}

interface RefineryLane {
  readonly cwd: string
  readonly branch: string
  readonly base: string
}

/** One line the refinery writes to an order's ledger. */
interface RefineryRecord {
  readonly orderId: string
  readonly action: string
  readonly subject: string
  readonly reason: string
}

export interface RefineryTickDeps {
  /** Every shipped/running order that has opened at least one pull. */
  readonly candidates: () => Promise<readonly RefineryCandidate[]>
  readonly readState: (orderId: string) => Promise<RefineryState>
  readonly writeState: (orderId: string, state: RefineryState) => Promise<void>
  /** `gh pr view <url> --json state,mergedAt,baseRefName`, already interpreted. */
  readonly viewPr: (url: string) => Promise<{ readonly merged: boolean }>
  /** Every in-flight order's queue entries, for `laterOverlapping`. */
  readonly entries: () => Promise<readonly QueueEntry[]>
  /** The lanes to restack for one overlapping order. */
  readonly lanesFor: (orderId: string) => Promise<readonly RefineryLane[]>
  readonly restack: (lane: RefineryLane) => Promise<RestackResult>
  /** One CI watch for the order's drafts, once its lanes are rebased. */
  readonly watchCi: (orderId: string) => Promise<void>
  readonly raiseConflict: (orderId: string, why: string, files: readonly string[]) => Promise<void>
  readonly record: (entry: RefineryRecord) => Promise<void>
  readonly titleOf: (orderId: string) => Promise<string>
  /** An order's pulls were all seen merged for the first time. Never throws into the tick. */
  readonly onMerged?: (orderId: string) => Promise<void>
  readonly now: () => string
}

/** Restack every lane of one order; the first conflict or failure stops it. */
async function restackLanes(
  deps: RefineryTickDeps,
  orderId: string
): Promise<{ conflictFiles: readonly string[] | null; failedReason: string | null }> {
  for (const lane of await deps.lanesFor(orderId)) {
    const result = await deps.restack(lane)
    if (result.kind === 'conflict') return { conflictFiles: result.files, failedReason: null }
    if (result.kind === 'failed') return { conflictFiles: null, failedReason: result.reason }
  }
  return { conflictFiles: null, failedReason: null }
}

export async function refineryTick(deps: RefineryTickDeps): Promise<void> {
  const mergedIds: string[] = []
  for (const candidate of await deps.candidates()) {
    if (await hasMerged(deps, candidate)) mergedIds.push(candidate.order.id)
  }
  if (mergedIds.length === 0) return

  const entries = await deps.entries()
  for (const mergedId of mergedIds) {
    const merged = { id: mergedId, title: await deps.titleOf(mergedId) }
    const overlapping = laterOverlapping(entries, mergedId)
    if (overlapping.length === 0) continue
    for (const overlap of overlapping) await restackBehind(deps, overlap, merged)
  }
}

/**
 * Whether every pull of the order has merged, recording the moment it is
 * first seen. An order with no pulls has nothing to watch yet.
 */
async function hasMerged(
  deps: RefineryTickDeps,
  { order, pulls }: RefineryCandidate
): Promise<boolean> {
  if (pulls.length === 0) return false
  const state = await deps.readState(order.id)
  if (state.mergedAt !== null) return true
  for (const pull of pulls) {
    if (!(await deps.viewPr(pull.url)).merged) return false
  }
  await deps.writeState(order.id, { ...state, mergedAt: deps.now() })
  const reason = `${order.title} merged`
  await deps.record({ orderId: order.id, action: 'refinery.merged', subject: order.id, reason })
  try {
    await deps.onMerged?.(order.id)
  } catch {
    // The tracker being briefly wrong must not stop the restack of what queued behind.
  }
  return true
}

/** Restacks one order that queued behind a merge, once per merge, and rechecks it. */
async function restackBehind(
  deps: RefineryTickDeps,
  { orderId, files }: { orderId: string; files: readonly string[] },
  merged: { id: string; title: string }
): Promise<void> {
  const state = await deps.readState(orderId)
  if (state.restackedFor.includes(merged.id)) return

  const { conflictFiles, failedReason } = await restackLanes(deps, orderId)
  const recordOnLedger = (action: string, reason: string) =>
    deps.record({ orderId, action, subject: orderId, reason })
  if (conflictFiles !== null) {
    const title = await deps.titleOf(orderId)
    const why = `${title} no longer rebases onto its base after ${merged.title} merged`
    await deps.raiseConflict(orderId, why, conflictFiles)
    await recordOnLedger('refinery.conflict', why)
    return
  }
  if (failedReason !== null) {
    await recordOnLedger('refinery.failed', failedReason)
    return
  }

  await deps.writeState(orderId, { ...state, restackedFor: [...state.restackedFor, merged.id] })
  await recordOnLedger(
    'refinery.rebased',
    `Rebased onto its base after ${merged.title} merged; shared files: ${files.join(', ')}.`
  )
  await deps.watchCi(orderId)
}
