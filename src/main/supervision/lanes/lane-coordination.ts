import type { Lane, WorkItemContract } from '../workitems/contract-schema.js'

// Multi-repository coordination (FR-086 – FR-090). All pure functions over the
// published contract, so a single-lane work item costs nothing: it renders as
// one row and none of this ceremony applies (FR-089).

export interface LaneView {
  readonly lane: Lane
  /** Files this lane shares with at least one other lane (FR-087). */
  readonly collisions: string[]
  readonly blockedBy: number[]
}

export interface MergeDecision {
  readonly allowed: boolean
  readonly reason: string | null
  /** The lane that must merge first, when one is blocking. */
  readonly blockingLane: number | null
}

/** Lanes in merge order, each carrying its predicted collisions. */
export function laneViews(item: WorkItemContract): LaneView[] {
  const shared = item.contract?.shared_files ?? []

  // A file is a predicted collision when more than one lane touches it. The
  // contract declares shared files once for the item, so every lane that
  // declares a dependency on the shared contract is a candidate.
  const sharing = item.lanes.filter(
    (lane) => lane.role === 'producer' || lane.blocked_by.length > 0
  )
  const collisions = sharing.length > 1 ? shared : []

  return [...item.lanes]
    .sort((a, b) => a.ord - b.ord)
    .map((lane) => ({
      lane,
      // Flagged on EVERY lane that touches it, not just the producer — the
      // point is to warn each agent before it starts, not after a conflict.
      collisions: sharing.some((s) => s.ord === lane.ord) ? collisions : [],
      blockedBy: [...lane.blocked_by].sort((a, b) => a - b),
    }))
}

/**
 * FR-088. A lane may not merge before the lanes that block it, when a shared
 * file is involved. Without a shared file the ordering is advisory — two lanes
 * touching nothing in common can land in any order.
 */
export function mayMergeLane(
  item: WorkItemContract,
  laneOrd: number,
  mergedOrds: readonly number[]
): MergeDecision {
  const lane = item.lanes.find((candidate) => candidate.ord === laneOrd)
  if (lane === undefined) {
    return { allowed: false, reason: `no lane ${laneOrd} in this work item`, blockingLane: null }
  }

  const sharedFiles = item.contract?.shared_files ?? []
  const outstanding = lane.blocked_by.filter((ord) => !mergedOrds.includes(ord))

  if (outstanding.length === 0) return { allowed: true, reason: null, blockingLane: null }

  if (sharedFiles.length === 0) {
    // Nothing in common, so order is a preference rather than a constraint.
    return { allowed: true, reason: null, blockingLane: null }
  }

  const blockingLane = Math.min(...outstanding)
  const blocking = item.lanes.find((candidate) => candidate.ord === blockingLane)
  return {
    allowed: false,
    reason: `lane ${blockingLane} (${blocking?.repo ?? 'unknown'}) must merge first — they share ${sharedFiles.join(', ')}`,
    blockingLane,
  }
}

/**
 * FR-090. When an upstream lane merges a change to a shared file after a
 * downstream lane started, that downstream lane is working against a contract
 * that has since moved.
 */
export function staleLanes(
  item: WorkItemContract,
  upstreamOrd: number,
  upstreamMergedAt: number,
  laneStartedAt: ReadonlyMap<number, number>
): number[] {
  if ((item.contract?.shared_files ?? []).length === 0) return []

  return item.lanes
    .filter((lane) => {
      if (!lane.blocked_by.includes(upstreamOrd)) return false
      const startedAt = laneStartedAt.get(lane.ord)
      // Started before the upstream merge landed, so it never saw the change.
      return startedAt !== undefined && startedAt < upstreamMergedAt
    })
    .map((lane) => lane.ord)
    .sort((a, b) => a - b)
}
