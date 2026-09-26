import type { HallMap, HallProp, RestSeat, Tile } from './layout.js'
import { TILE_PX } from './layout.js'
import { findPath, distancesFrom } from './path.js'
import { gateNodeId, hasStarted } from './events.js'
import type { Observation } from './events.js'
import type { NodeState, RunNode } from '../line/run-graph.js'
import type { StepKind } from '../recipe/parse.js'

// The world a scene renders: crew walking a hall, crates riding belts.
//
// Pure and deterministic on purpose. The renderer owns the only mutable ref
// (`worldRef` in `HallScene`), advances it every frame with `tick`, and never
// touches `Math.random` or `Date` in here — a replay of the same events and
// the same tick sizes always lands crew on the same pixel.

export type CrewAnim = 'walk' | 'idle' | 'type' | 'reach' | 'scan' | 'wave' | 'slump' | 'couch'
export type Facing = 'N' | 'S' | 'E' | 'W'

export interface Crew {
  readonly nodeId: string
  readonly role: string | null
  readonly x: number
  readonly y: number
  readonly facing: Facing
  readonly anim: CrewAnim
  readonly path: readonly Tile[]
  readonly goal: Tile | null
  readonly then: CrewAnim
  readonly present: boolean
  /** The breakroom seat this crew member currently occupies, or is headed to sit in; null otherwise. */
  readonly restSeat: number | null
  /** The facing to adopt on arrival at `goal` — set alongside a rest seat, cleared for every other errand. */
  readonly settle: Facing | null
}

export interface Crate {
  readonly id: string
  readonly beltId: string
  readonly progress: number
  /** Waits at the end of its belt until the step it feeds starts, instead of vanishing. */
  readonly parks: boolean
}

/**
 * A tool call the director has seen open and not yet seen close.
 *
 * `direct` is called on every poll with only the *new* events — a long Read
 * emits `tool_started` exactly once — so "still open ≥1500ms" can only ever
 * be judged against a call the world remembers, not one just arriving in the
 * current batch.
 */
export interface OpenCall {
  readonly nodeId: string
  readonly prop: string
  readonly callId: string
  readonly at: number
}

export interface World {
  readonly map: HallMap
  readonly crew: readonly Crew[]
  readonly crates: readonly Crate[]
  readonly gatesWaiting: readonly string[]
  readonly openCalls: readonly OpenCall[]
  readonly clockMs: number
}

const WALK_PX_PER_S = 46
const CRATE_PX_PER_S = 34

/** A node counts as crewed when someone works it: a role, or a working kind. */
const CREWED_KINDS: readonly StepKind[] = ['agent', 'fanout', 'run', 'judge']

const NEIGHBOUR_STEPS: readonly Tile[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

function key(tile: Tile): string {
  return `${tile.x},${tile.y}`
}

export function workAnim(kind: StepKind): CrewAnim {
  return kind === 'run' || kind === 'judge' ? 'scan' : 'type'
}

export function tileCenter(tile: Tile): { readonly x: number; readonly y: number } {
  return { x: tile.x * TILE_PX + 8, y: tile.y * TILE_PX + 12 }
}

export function tileOf(x: number, y: number): Tile {
  return { x: Math.round((x - 8) / TILE_PX), y: Math.round((y - 12) / TILE_PX) }
}

export function stationOf(map: HallMap, nodeId: string): HallProp | null {
  return map.props.find((p) => p.nodeId === nodeId) ?? null
}

export function seatOf(map: HallMap, nodeId: string): Tile | null {
  return stationOf(map, nodeId)?.seat ?? null
}

/**
 * The free breakroom seat nearest `from`, walked over `map.walk`.
 *
 * A seat tile is only enterable once it is free, so its distance is one more
 * than the shortest flood distance among its four neighbours. Ties go to the
 * lower seat id: `map.restSeats` is already ordered that way, and the
 * comparison below is a strict `<`, so the first seat reached at the best
 * distance is the one that wins.
 */
export function nearestRestSeat(
  map: HallMap,
  from: Tile,
  taken: ReadonlySet<number>
): RestSeat | null {
  const distances = distancesFrom(map.walk, from)
  let best: RestSeat | null = null
  let bestDistance = Infinity
  for (const seat of map.restSeats) {
    if (taken.has(seat.id)) continue
    const neighbourDistance = Math.min(
      ...NEIGHBOUR_STEPS.map(
        (s) => distances.get(key({ x: seat.tile.x + s.x, y: seat.tile.y + s.y })) ?? Infinity
      )
    )
    const distance = neighbourDistance + 1
    if (distance < bestDistance) {
      bestDistance = distance
      best = seat
    }
  }
  return best
}

interface Placement {
  readonly tile: Tile
  readonly anim: CrewAnim
  readonly facing: Facing
  readonly restSeat: number | null
  readonly settle: Facing | null
}

const WORKING: Omit<Placement, 'tile' | 'anim'> = { facing: 'S', restSeat: null, settle: null }

function placementFor(map: HallMap, node: RunNode, taken: Set<number>): Placement | null {
  const seat = seatOf(map, node.id)
  if (seat === null) return null
  switch (node.state) {
    case 'running':
    case 'verifying':
      return { tile: seat, anim: workAnim(node.kind), ...WORKING }
    case 'ready':
      return { tile: seat, anim: 'idle', ...WORKING }
    case 'failed':
      return { tile: seat, anim: 'slump', ...WORKING }
    case 'passed':
    case 'waiting':
    case 'skipped':
    case 'blocked': {
      const rest = nearestRestSeat(map, seat, taken)
      /* v8 ignore next -- a hall always has at least (crewed + 2) rest seats */
      if (rest === null) return { tile: seat, anim: 'idle', ...WORKING }
      taken.add(rest.id)
      return {
        tile: rest.tile,
        anim: 'couch',
        facing: rest.facing,
        restSeat: rest.id,
        settle: rest.facing,
      }
    }
    /* v8 ignore next 3 -- exhaustive union, unreachable */
    default: {
      const never: never = node.state
      throw new Error(`unhandled node state: ${String(never)}`)
    }
  }
}

function isCrewed(node: RunNode): boolean {
  return node.role !== null || CREWED_KINDS.includes(node.kind)
}

/** Placement settled on first load: nobody walks in, everyone is where the run left them. */
export function createWorld(map: HallMap, observation: Observation): World {
  const orphaned = new Set(observation.orphaned)
  const crew: Crew[] = []
  const taken = new Set<number>()
  for (const node of observation.graph.nodes) {
    if (!isCrewed(node)) continue
    const placement = placementFor(map, node, taken)
    if (placement === null) continue
    const center = tileCenter(placement.tile)
    crew.push({
      nodeId: node.id,
      role: node.role,
      x: center.x,
      y: center.y,
      facing: placement.facing,
      anim: placement.anim,
      path: [],
      goal: null,
      then: placement.anim,
      present: !orphaned.has(node.id),
      restSeat: placement.restSeat,
      settle: placement.settle,
    })
  }

  const gatesWaiting = new Set<string>()
  for (const gate of observation.waiting) {
    const nodeId = gateNodeId(gate, observation.graph)
    if (nodeId !== null) gatesWaiting.add(nodeId)
  }

  // Work already finished and not yet taken in shows as a crate waiting at
  // the step it feeds, so a hall opened mid-run reads the queue at a glance.
  const states = new Map(observation.graph.nodes.map((n) => [n.id, n.state]))
  const crates: Crate[] = map.belts
    .filter(
      (belt) =>
        states.get(belt.fromNodeId) === 'passed' &&
        !hasStarted(states.get(belt.toNodeId) as NodeState)
    )
    .map((belt) => ({ id: `${belt.id}@queued`, beltId: belt.id, progress: 1, parks: true }))

  return { map, crew, crates, gatesWaiting: [...gatesWaiting], openCalls: [], clockMs: 0 }
}

/**
 * Where a crate is drawn, in world px.
 *
 * A belt's path now ends beside the station it feeds, not under its chair,
 * so the whole path is ridden — nothing is dropped from the end. Linear
 * between tile centres, so it glides instead of jumping.
 */
export function cratePosition(
  belt: HallMap['belts'][number],
  progress: number
): { readonly x: number; readonly y: number } {
  const stops = belt.path
  const at = Math.min(Math.max(progress, 0), 1) * (stops.length - 1)
  const from = stops[Math.floor(at)]
  const to = stops[Math.min(Math.floor(at) + 1, stops.length - 1)]
  const t = at - Math.floor(at)
  return {
    x: (from.x + (to.x - from.x) * t) * TILE_PX + 8,
    y: (from.y + (to.y - from.y) * t) * TILE_PX + 10,
  }
}

function beltDistance(belt: { readonly path: readonly Tile[] }): number {
  return Math.max(belt.path.length, 1) * TILE_PX
}

function tickCrate(world: World, crate: Crate, dtSec: number): Crate | null {
  const belt = world.map.belts.find((b) => b.id === crate.beltId)
  const distance = belt === undefined ? TILE_PX : beltDistance(belt)
  const progress = crate.progress + (CRATE_PX_PER_S * dtSec) / distance
  if (progress >= 1) return crate.parks ? { ...crate, progress: 1 } : null
  return { ...crate, progress }
}

function facingFor(dx: number, dy: number, prior: Facing): Facing {
  if (dx === 0 && dy === 0) return prior
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'E' : 'W'
  return dy > 0 ? 'S' : 'N'
}

function tickCrew(map: HallMap, crew: Crew, dtSec: number): Crew {
  if (crew.goal === null && crew.path.length === 0) return crew

  let path = crew.path
  if (path.length === 0 && crew.goal !== null) {
    path = findPath(map.walk, tileOf(crew.x, crew.y), crew.goal)
    if (path.length === 0) {
      // Already there, or nothing found: arrival either way.
      return { ...crew, goal: null, anim: crew.then, facing: crew.settle ?? crew.facing }
    }
  }

  const target = tileCenter(path[0])
  const dx = target.x - crew.x
  const dy = target.y - crew.y
  const remaining = Math.hypot(dx, dy)
  const step = WALK_PX_PER_S * dtSec
  const facing = facingFor(dx, dy, crew.facing)

  if (remaining <= step) {
    const rest = path.slice(1)
    if (rest.length === 0) {
      return {
        ...crew,
        x: target.x,
        y: target.y,
        facing: crew.settle ?? facing,
        path: [],
        goal: null,
        anim: crew.then,
      }
    }
    return { ...crew, x: target.x, y: target.y, facing, path: rest, anim: 'walk' }
  }

  const x = crew.x + (dx / remaining) * step
  const y = crew.y + (dy / remaining) * step
  return { ...crew, x, y, facing, path, anim: 'walk' }
}

export function tick(world: World, dtMs: number): World {
  const dtSec = dtMs / 1000
  const crew = world.crew.map((c) => tickCrew(world.map, c, dtSec))
  const crates = world.crates
    .map((crate) => tickCrate(world, crate, dtSec))
    .filter((crate): crate is Crate => crate !== null)
  return { ...world, crew, crates, clockMs: world.clockMs + dtMs }
}
