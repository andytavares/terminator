import { hasStarted } from './events.js'
import type { FactoryEvent } from './events.js'
import { seatOf, nearestRestSeat, tileOf } from './sim.js'
import type { World, Crew, Crate, OpenCall } from './sim.js'

// Turns events into motion.
//
// Every branch here answers one question: given this event, where should the
// crew member for that node be headed, and what should they do on arrival?
// Nothing here moves anyone for a reason that is not one of `FactoryEvent`'s
// variants — that is the honesty rule the events module exists to police.

const TOOL_OPEN_MS = 1500
const TOOL_BURST_COUNT = 3

function withCrew(world: World, nodeId: string, update: (crew: Crew) => Crew): World {
  let changed = false
  const crew = world.crew.map((c) => {
    if (c.nodeId !== nodeId) return c
    changed = true
    return update(c)
  })
  return changed ? { ...world, crew } : world
}

function sendTo(crew: Crew, goal: Crew['goal'], then: Crew['then']): Crew {
  return { ...crew, goal, then, restSeat: null, settle: null }
}

/**
 * Send a crew member from wherever they currently stand to the nearest free
 * breakroom seat, and mark that seat theirs.
 *
 * `taken` is every *other* crew member's `restSeat` — the node's own past
 * seat, if any, is released first, so a node that goes idle twice in a row
 * can still pick the same seat it just left.
 */
function sendToRest(world: World, nodeId: string): World {
  const crew = world.crew.find((c) => c.nodeId === nodeId)
  if (crew === undefined) return world
  const taken = new Set(
    world.crew
      .filter((c) => c.nodeId !== nodeId && c.restSeat !== null)
      .map((c) => c.restSeat as number)
  )
  const seat = nearestRestSeat(world.map, tileOf(crew.x, crew.y), taken)
  /* v8 ignore next -- a hall always has at least (crewed + 2) rest seats */
  if (seat === null) return world
  return withCrew(world, nodeId, (c) => ({
    ...c,
    goal: seat.tile,
    then: 'couch',
    settle: seat.facing,
    restSeat: seat.id,
  }))
}

/**
 * Whether a node's open calls of one prop are worth walking for: one of them
 * has run long enough on its own, or there are enough of them at once.
 *
 * Judged against `World.openCalls`, not the events batch: `direct` is called
 * on every poll with only the *new* events, and a long-running call emits
 * `tool_started` exactly once — so "still open ≥1500ms" can only ever be true
 * of a call the world remembers from an earlier poll, not one arriving now.
 * The burst count needs no separate 10s window check either: every call
 * counted here is still open, so if none of them is individually ≥1500ms
 * old, they are all well under 10s old.
 */
function toolBurstWalks(calls: readonly OpenCall[], nowMs: number): boolean {
  if (calls.some((c) => nowMs - c.at >= TOOL_OPEN_MS)) return true
  return calls.length >= TOOL_BURST_COUNT
}

function openCallKey(nodeId: string, prop: string): string {
  return `${nodeId}:${prop}`
}

/** Send every crew member whose remembered open calls now justify a walk. */
function applyOpenCallWalks(world: World, nowMs: number): World {
  const groups = new Map<string, OpenCall[]>()
  for (const call of world.openCalls) {
    const key = openCallKey(call.nodeId, call.prop)
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [call])
    else group.push(call)
  }

  let next = world
  for (const calls of groups.values()) {
    if (!toolBurstWalks(calls, nowMs)) continue
    const { nodeId, prop } = calls[0]
    const anchor = prop === 'archive' ? world.map.anchors.archive : world.map.anchors.rack
    next = withCrew(next, nodeId, (crew) => sendTo(crew, anchor, 'reach'))
  }
  return next
}

/** A step that starts takes in the work queued at it: those crates stop parking. */
function consumeQueued(world: World, nodeId: string): World {
  const into = new Set(world.map.belts.filter((b) => b.toNodeId === nodeId).map((b) => b.id))
  if (!world.crates.some((c) => c.parks && into.has(c.beltId))) return world
  return {
    ...world,
    crates: world.crates.map((c) => (c.parks && into.has(c.beltId) ? { ...c, parks: false } : c)),
  }
}

function applyNodeState(world: World, event: Extract<FactoryEvent, { kind: 'node-state' }>): World {
  const fed = hasStarted(event.to) ? consumeQueued(world, event.nodeId) : world
  switch (event.to) {
    case 'ready':
    case 'running':
    case 'verifying':
      return withCrew(fed, event.nodeId, (crew) => {
        const kind = world.map.props.find((p) => p.nodeId === event.nodeId)?.kind ?? 'desk'
        const anim = kind === 'rig' || kind === 'bench' ? 'scan' : 'type'
        const seat = seatOf(world.map, event.nodeId)
        return seat === null ? crew : sendTo(crew, seat, anim)
      })
    case 'failed':
      return withCrew(fed, event.nodeId, (crew) => {
        const seat = seatOf(world.map, event.nodeId)
        return seat === null ? crew : sendTo(crew, seat, 'slump')
      })
    case 'passed':
    case 'waiting':
    case 'skipped':
    case 'blocked':
      return sendToRest(fed, event.nodeId)
    /* v8 ignore next 3 -- exhaustive union, unreachable */
    default: {
      const never: never = event.to
      throw new Error(`unhandled node state: ${String(never)}`)
    }
  }
}

function applyOrphaned(world: World, event: Extract<FactoryEvent, { kind: 'orphaned' }>): World {
  return withCrew(world, event.nodeId, (crew) => ({ ...crew, present: false }))
}

function applyStranded(world: World, event: Extract<FactoryEvent, { kind: 'stranded' }>): World {
  return withCrew(world, event.nodeId, (crew) => {
    if (event.on) return sendTo(crew, world.map.anchors.wait, 'wave')
    const seat = seatOf(world.map, event.nodeId)
    return seat === null ? crew : sendTo(crew, seat, 'idle')
  })
}

/** Record or clear a call in `openCalls`. Walking itself happens in `applyOpenCallWalks`. */
function applyTool(world: World, event: Extract<FactoryEvent, { kind: 'tool' }>): World {
  if (event.prop === 'desk') return world

  if (event.open) {
    const already = world.openCalls.some(
      (c) => c.nodeId === event.nodeId && c.prop === event.prop && c.callId === event.callId
    )
    if (already) return world
    const call: OpenCall = {
      nodeId: event.nodeId,
      prop: event.prop,
      callId: event.callId,
      at: event.at,
    }
    return { ...world, openCalls: [...world.openCalls, call] }
  }

  const openCalls = world.openCalls.filter(
    (c) => !(c.nodeId === event.nodeId && c.prop === event.prop && c.callId === event.callId)
  )
  const stillOpen = openCalls.some((c) => c.nodeId === event.nodeId && c.prop === event.prop)
  let next: World = { ...world, openCalls }
  if (!stillOpen) {
    next = withCrew(next, event.nodeId, (crew) => {
      const seat = seatOf(world.map, event.nodeId)
      return seat === null ? crew : sendTo(crew, seat, 'idle')
    })
  }
  return next
}

function applyHandoff(world: World, event: Extract<FactoryEvent, { kind: 'handoff' }>): World {
  const belt = world.map.belts.find(
    (b) => b.fromNodeId === event.fromNodeId && b.toNodeId === event.toNodeId
  )
  if (belt === undefined) return world
  const crate: Crate = {
    id: `${belt.id}@${world.clockMs}`,
    beltId: belt.id,
    progress: 0,
    parks: !event.targetStarted,
  }
  return { ...world, crates: [...world.crates, crate] }
}

/**
 * A check sending work back: the crate rides the same belt a hand-off would
 * use between the target and the check, but the other way — starting at the
 * check's station and parking at the target's, since the target's own
 * `node-state` event (back to `waiting`) is what actually seats its crew.
 */
function applyRework(world: World, event: Extract<FactoryEvent, { kind: 'rework' }>): World {
  const belt = world.map.belts.find(
    (b) => b.fromNodeId === event.toNodeId && b.toNodeId === event.fromNodeId
  )
  if (belt === undefined) return world
  const crate: Crate = {
    id: `${belt.id}@${world.clockMs}:rework${event.round}`,
    beltId: belt.id,
    progress: 0,
    parks: true,
  }
  return { ...world, crates: [...world.crates, crate] }
}

function applyGate(world: World, event: Extract<FactoryEvent, { kind: 'gate' }>): World {
  const gatesWaiting = event.waiting
    ? world.gatesWaiting.includes(event.nodeId)
      ? world.gatesWaiting
      : [...world.gatesWaiting, event.nodeId]
    : world.gatesWaiting.filter((id) => id !== event.nodeId)

  const foreman = world.crew.find((c) => c.role === 'foreman')
  let world2 = { ...world, gatesWaiting }
  if (foreman !== undefined) {
    if (event.waiting) {
      const seat = seatOf(world.map, event.nodeId)
      if (seat !== null) world2 = withCrew(world2, foreman.nodeId, (c) => sendTo(c, seat, 'wave'))
    } else {
      const seat = seatOf(world.map, foreman.nodeId)
      if (seat !== null) world2 = withCrew(world2, foreman.nodeId, (c) => sendTo(c, seat, 'idle'))
    }
  }
  return world2
}

/** A run's round advancing: the dispatch tower's own count moves on. */
function applyCiRound(world: World, event: Extract<FactoryEvent, { kind: 'ci-round' }>): World {
  return { ...world, ci: { round: event.round, max: event.max, checks: world.ci?.checks ?? {} } }
}

/** One check's lamp changing colour on the dispatch tower. */
function applyCiCheck(world: World, event: Extract<FactoryEvent, { kind: 'ci-check' }>): World {
  const base = world.ci ?? { round: 0, max: 0, checks: {} }
  return { ...world, ci: { ...base, checks: { ...base.checks, [event.name]: event.bucket } } }
}

export function direct(world: World, events: readonly FactoryEvent[], nowMs: number): World {
  let next = world
  for (const event of events) {
    switch (event.kind) {
      case 'node-state':
        next = applyNodeState(next, event)
        break
      case 'orphaned':
        next = applyOrphaned(next, event)
        break
      case 'stranded':
        next = applyStranded(next, event)
        break
      case 'tool':
        next = applyTool(next, event)
        break
      case 'handoff':
        next = applyHandoff(next, event)
        break
      case 'gate':
        next = applyGate(next, event)
        break
      case 'rework':
        next = applyRework(next, event)
        break
      case 'ci-round':
        next = applyCiRound(next, event)
        break
      case 'ci-check':
        next = applyCiCheck(next, event)
        break
      /* v8 ignore next 3 -- exhaustive union, unreachable */
      default: {
        const never: never = event
        throw new Error(`unhandled factory event: ${String(never)}`)
      }
    }
  }
  // A call remembered from an earlier poll can cross the ≥1500ms threshold
  // with no new event at all — this is what makes that case reachable.
  return applyOpenCallWalks(next, nowMs)
}
