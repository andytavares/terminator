import type { Lane, WorkOrder } from './schema.js'

// Lanes, and the one thing that makes their order matter.
//
// A lane is a repository. An order that touches one repository has one lane
// and every rule here collapses to nothing — that is deliberate, and it is
// what keeps the common case free of machinery it does not need (FR-068).
//
// The ordering only binds where two lanes touch the same file. Two lanes with
// nothing in common can land in either order, and pretending otherwise would
// serialise work for no reason.

/**
 * Files more than one lane touches, derived from the plan rather than declared.
 *
 * Derived because a declaration written by an agent is a claim, and a claim
 * about collisions is exactly the kind that is quietly wrong. The units say
 * what they touch; two lanes touching one path is a collision whether or not
 * anybody wrote it down.
 */
export function sharedFilesFor(order: WorkOrder): string[] {
  const lanesByPath = new Map<string, Set<number>>()
  for (const unit of order.plan.units) {
    for (const path of unit.touches) {
      const lanes = lanesByPath.get(path) ?? new Set<number>()
      lanes.add(unit.lane)
      lanesByPath.set(path, lanes)
    }
  }
  return [...lanesByPath.entries()]
    .filter(([, lanes]) => lanes.size > 1)
    .map(([path]) => path)
    .sort()
}

/** Which lanes touch a given path, in order. */
function lanesTouching(order: WorkOrder, path: string): number[] {
  return [
    ...new Set(order.plan.units.filter((u) => u.touches.includes(path)).map((u) => u.lane)),
  ].sort((a, b) => a - b)
}

/** Every lane involved in at least one collision. */
export function collidingLanes(order: WorkOrder, shared: readonly string[]): number[] {
  const involved = new Set<number>()
  for (const path of shared) for (const lane of lanesTouching(order, path)) involved.add(lane)
  return [...involved].sort((a, b) => a - b)
}

/**
 * Fill in `sharedFiles` and the merge ordering the collisions imply.
 *
 * The producing lane is *declared*, never guessed: which repository owns the
 * shared contract is a fact about the change, and inferring it from lane
 * numbers would be a coin flip dressed as a decision. What is derived is
 * everything that follows from the declaration — the collisions themselves,
 * and which lanes wait for which.
 */
export function planLanes(order: WorkOrder): WorkOrder {
  const sharedFiles = sharedFilesFor(order)
  const involved = collidingLanes(order, sharedFiles)
  const producer = order.plan.lanes.find(
    (lane) => lane.role === 'producer' && involved.includes(lane.ord)
  )

  const lanes: Lane[] = order.plan.lanes.map((lane) => {
    // A lane in no collision is unconstrained, whatever it was carrying
    // before — a stale `blockedBy` left over from an earlier plan would
    // serialise work that has nothing to wait for.
    if (producer === undefined || !involved.includes(lane.ord)) {
      return { ...lane, blocks: [], blockedBy: [] }
    }
    if (lane.ord === producer.ord) {
      return {
        ...lane,
        role: 'producer',
        blocks: involved.filter((ord) => ord !== producer.ord),
        blockedBy: [],
      }
    }
    return { ...lane, role: 'consumer', blocks: [], blockedBy: [producer.ord] }
  })

  return { ...order, plan: { ...order.plan, sharedFiles, lanes } }
}

export interface LaneView {
  readonly lane: Lane
  /** Files this lane shares with at least one other (FR-066). */
  readonly collisions: readonly string[]
  readonly blockedBy: readonly number[]
}

/** Lanes in merge order, each carrying the collisions it is party to. */
export function laneViews(order: WorkOrder): LaneView[] {
  const shared = order.plan.sharedFiles
  return [...order.plan.lanes]
    .sort((a, b) => a.ord - b.ord)
    .map((lane) => ({
      lane,
      // Flagged on EVERY lane that touches it, not only the producer: the
      // point is to warn each agent before it starts, not after a conflict.
      collisions: shared.filter((path) => lanesTouching(order, path).includes(lane.ord)),
      blockedBy: [...lane.blockedBy].sort((a, b) => a - b),
    }))
}

export interface MergeDecision {
  readonly allowed: boolean
  readonly reason: string | null
  /** The lane that must merge first, when one is blocking. */
  readonly blockingLane: number | null
}

/**
 * Whether a lane may merge yet (FR-067).
 *
 * Blocked only by a lane it actually shares a file with. Without a shared file
 * the ordering is a preference, and enforcing a preference costs wall-clock
 * for nothing.
 */
export function mayMergeLane(
  order: WorkOrder,
  laneOrd: number,
  mergedOrds: readonly number[]
): MergeDecision {
  const lane = order.plan.lanes.find((candidate) => candidate.ord === laneOrd)
  if (lane === undefined) {
    return { allowed: false, reason: `no lane ${laneOrd} in this order`, blockingLane: null }
  }

  const outstanding = lane.blockedBy.filter((ord) => !mergedOrds.includes(ord))
  if (outstanding.length === 0 || order.plan.sharedFiles.length === 0) {
    return { allowed: true, reason: null, blockingLane: null }
  }

  const blockingLane = Math.min(...outstanding)
  const blocking = order.plan.lanes.find((candidate) => candidate.ord === blockingLane)
  return {
    allowed: false,
    reason: `lane ${blockingLane} (${blocking?.repo ?? 'unknown'}) must merge first — they share ${order.plan.sharedFiles.join(', ')}`,
    blockingLane,
  }
}
