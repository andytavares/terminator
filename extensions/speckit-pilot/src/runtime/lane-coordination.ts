// Lanes as a card declares them, rather than as the application's published
// work-item contract described them. A card that touches more than one
// repository has one lane per repository; a card that does not has one lane and
// every rule below collapses to a no-op.
export interface Lane {
  /** Merge order. Lane 1 is merged before lane 2. */
  readonly ord: number
  readonly repo: string
  readonly branch: string
  /**
   * A producer changes something the others consume — the shared contract file.
   * Consumers wait for it, which is what makes the ordering matter at all.
   */
  readonly role?: 'producer' | 'consumer'
  /**
   * Lanes that cannot merge until this one has, and the ones this waits on.
   * Required rather than optional: every rule below reads them, and an absent
   * array and an empty one mean the same thing, so normalising once at the
   * edge is cheaper than guarding at every use.
   */
  readonly blocks: readonly number[]
  readonly blocked_by: readonly number[]
}

export interface CardLanes {
  readonly id: string
  readonly lanes: readonly Lane[]
  readonly contract?: {
    /** Files more than one lane touches — a predicted collision. */
    readonly shared_files?: readonly string[]
  }
}

// Multi-repository coordination (FR-086 – FR-090). All pure functions over the
// published contract, so a single-lane work item costs nothing: it renders as
// one row and none of this ceremony applies (FR-089).

export interface LaneView {
  readonly lane: Lane
  /** Files this lane shares with at least one other lane (FR-087). */
  readonly collisions: readonly string[]
  readonly blockedBy: readonly number[]
}

export interface MergeDecision {
  readonly allowed: boolean
  readonly reason: string | null
  /** The lane that must merge first, when one is blocking. */
  readonly blockingLane: number | null
}

/** Lanes in merge order, each carrying its predicted collisions. */
export function laneViews(item: CardLanes): LaneView[] {
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
  item: CardLanes,
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
