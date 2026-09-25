import type { FactoryEvent } from './events.js'
import { seatOf, loungeSpot } from './sim.js'
import type { World, Crew, Crate } from './sim.js'

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
  return { ...crew, goal, then }
}

/**
 * Whether an open tool call is worth walking for: on its own, once it has run
 * long enough, or as a burst of the same prop.
 *
 * The burst count needs no separate 10s window check: every call counted here
 * is one this same batch just saw open, so if none of them is individually
 * ≥1500ms old, the whole batch is well under 10s wide already.
 */
function toolBurstWalks(
  events: readonly FactoryEvent[],
  nodeId: string,
  prop: string,
  nowMs: number
): boolean {
  const opens = events.filter(
    (e): e is Extract<FactoryEvent, { kind: 'tool' }> =>
      e.kind === 'tool' && e.nodeId === nodeId && e.prop === prop && e.open
  )
  if (opens.some((e) => nowMs - e.at >= TOOL_OPEN_MS)) return true
  return opens.length >= TOOL_BURST_COUNT
}

/** Whether any call of this prop is still open for the node, after this event. */
function toolStillOpen(
  events: readonly FactoryEvent[],
  nodeId: string,
  prop: string,
  exceptCallId: string
): boolean {
  return events.some(
    (e) =>
      e.kind === 'tool' &&
      e.nodeId === nodeId &&
      e.prop === prop &&
      e.open &&
      e.callId !== exceptCallId
  )
}

function applyNodeState(world: World, event: Extract<FactoryEvent, { kind: 'node-state' }>): World {
  return withCrew(world, event.nodeId, (crew) => {
    switch (event.to) {
      case 'ready':
      case 'running':
      case 'verifying': {
        const kind = world.map.props.find((p) => p.nodeId === event.nodeId)?.kind ?? 'desk'
        const anim = kind === 'rig' || kind === 'bench' ? 'scan' : 'type'
        const seat = seatOf(world.map, event.nodeId)
        return seat === null ? crew : sendTo(crew, seat, anim)
      }
      case 'passed':
        return sendTo(crew, loungeSpot(world.map, event.nodeId), 'couch')
      case 'failed': {
        const seat = seatOf(world.map, event.nodeId)
        return seat === null ? crew : sendTo(crew, seat, 'slump')
      }
      case 'waiting':
      case 'skipped':
      case 'blocked':
        return sendTo(crew, loungeSpot(world.map, event.nodeId), 'idle')
      /* v8 ignore next 3 -- exhaustive union, unreachable */
      default: {
        const never: never = event.to
        throw new Error(`unhandled node state: ${String(never)}`)
      }
    }
  })
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

function applyTool(
  world: World,
  event: Extract<FactoryEvent, { kind: 'tool' }>,
  events: readonly FactoryEvent[],
  nowMs: number
): World {
  if (event.prop === 'desk') return world
  return withCrew(world, event.nodeId, (crew) => {
    if (event.open) {
      if (!toolBurstWalks(events, event.nodeId, event.prop, nowMs)) return crew
      const anchor = event.prop === 'archive' ? world.map.anchors.archive : world.map.anchors.rack
      return sendTo(crew, anchor, 'reach')
    }
    if (toolStillOpen(events, event.nodeId, event.prop, event.callId)) return crew
    const seat = seatOf(world.map, event.nodeId)
    return seat === null ? crew : sendTo(crew, seat, 'idle')
  })
}

function applyHandoff(world: World, event: Extract<FactoryEvent, { kind: 'handoff' }>): World {
  const belt = world.map.belts.find(
    (b) => b.fromNodeId === event.fromNodeId && b.toNodeId === event.toNodeId
  )
  if (belt === undefined) return world
  const crate: Crate = { id: `${belt.id}@${world.clockMs}`, beltId: belt.id, progress: 0 }
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
        next = applyTool(next, event, events, nowMs)
        break
      case 'handoff':
        next = applyHandoff(next, event)
        break
      case 'gate':
        next = applyGate(next, event)
        break
      /* v8 ignore next 3 -- exhaustive union, unreachable */
      default: {
        const never: never = event
        throw new Error(`unhandled factory event: ${String(never)}`)
      }
    }
  }
  return next
}
