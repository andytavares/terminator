import type { HallMap, HallProp, RestSeat, Tile } from './layout.js'
import { TILE_PX } from './layout.js'
import { findPath, distancesFrom } from './path.js'
import { gateNodeId, hasStarted } from './events.js'
import type { Observation } from './events.js'
import type { NodeState, RunNode } from '../line/run-graph.js'
import type { StepKind } from '../recipe/parse.js'
import type { Check } from '../line/ci.js'
import { mulberry32 } from './art/kit.js'

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
  /** Clock ms of the next stroll, or of the walk home once one has reached its spot; null when none is due. */
  readonly idleAt?: number | null
  /** Where an idle stroll has got to. Null while seated, or on any errand a real event sent. */
  readonly wander?: 'out' | 'there' | 'back' | null
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

/** A step that just passed or failed, for the verdict flash on its station; `at` is world `clockMs`. */
export interface Verdict {
  readonly nodeId: string
  readonly pass: boolean
  readonly at: number
}

/** What the dispatch tower shows: a round, and each check's own lamp. */
export interface WorldCi {
  readonly round: number
  readonly max: number
  readonly checks: Readonly<Record<string, Check['bucket']>>
}

export interface World {
  readonly map: HallMap
  readonly crew: readonly Crew[]
  readonly crates: readonly Crate[]
  readonly gatesWaiting: readonly string[]
  readonly openCalls: readonly OpenCall[]
  /** A step that just passed or failed, for the verdict flash on its station; `at` is world `clockMs`. */
  readonly verdicts: readonly Verdict[]
  readonly clockMs: number
  /** Null until the order has shipped a pull and CI has something to say. */
  readonly ci: WorldCi | null
  /** This order's place in the refinery's file-overlap queue. Null out of a queue. */
  readonly queue: { readonly position: number; readonly behind: readonly string[] } | null
}

const WALK_PX_PER_S = 46
const CRATE_PX_PER_S = 34

/** How long a verdict flash stays on its station. */
export const VERDICT_MS = 1600

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

/** What a crew member does at their station while their step runs: scan at a rig or bench, else type. */
export function workAnimFor(map: HallMap, nodeId: string): CrewAnim {
  const kind = stationOf(map, nodeId)?.kind
  return kind === 'rig' || kind === 'bench' ? 'scan' : 'type'
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

  const ci: WorldCi | null =
    observation.ci === null
      ? null
      : {
          round: observation.ci.round,
          max: observation.ci.max,
          checks: Object.fromEntries(
            observation.ci.pulls.flatMap((pull) => pull.checks.map((c) => [c.name, c.bucket]))
          ),
        }

  const queue =
    observation.queue === null
      ? null
      : {
          position: observation.queue.position,
          behind: observation.queue.behind.map((entry) => entry.title),
        }

  return {
    map,
    crew,
    crates,
    gatesWaiting: [...gatesWaiting],
    openCalls: [],
    verdicts: [],
    clockMs: 0,
    ci,
    queue,
  }
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

const STROLL_EVERY_MS = { min: 20_000, max: 40_000 }
const STROLL_LINGER_MS = { min: 3_000, max: 6_000 }
const MAX_LOITER_POINTS = 8

function hashOf(text: string): number {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 33) + text.charCodeAt(i)) | 0
  return h
}

/** A seeded duration in `[min, max)`: the same crew member at the same clock always draws the same one. */
function seededSpan(nodeId: string, clockMs: number, span: { min: number; max: number }): number {
  const rnd = mulberry32(hashOf(nodeId) ^ Math.floor(clockMs))
  return span.min + rnd() * (span.max - span.min)
}

const loiterCache = new WeakMap<HallMap, readonly Tile[]>()

/**
 * Where an idle crew member may stroll to: the free floor beside the coffee
 * bar and the vending machine, and beside a few belts. Only tiles the
 * breakroom door can walk to count, so nobody is ever sent somewhere
 * unreachable. Derived from the map alone, in a fixed order.
 */
export function loiterPoints(map: HallMap): readonly Tile[] {
  const cached = loiterCache.get(map)
  if (cached !== undefined) return cached
  const door = map.breakroom.door[0]
  const reach = door === undefined ? new Map<string, number>() : distancesFrom(map.walk, door)
  const free = (t: Tile): boolean => map.walk[t.y]?.[t.x] === false && reach.has(key(t))
  const beside = (t: Tile): Tile | undefined =>
    NEIGHBOUR_STEPS.map((s) => ({ x: t.x + s.x, y: t.y + s.y })).find(free)

  const points: Tile[] = []
  const add = (t: Tile | undefined): void => {
    if (t !== undefined && !points.some((p) => p.x === t.x && p.y === t.y)) points.push(t)
  }
  for (const prop of map.props) {
    if (prop.kind === 'coffeebar' || prop.kind === 'vending') add(beside({ x: prop.x, y: prop.y }))
  }
  const belts = map.belts.filter((b) => b.path.length > 2)
  const stride = Math.max(1, Math.ceil(belts.length / (MAX_LOITER_POINTS - points.length)))
  for (let i = 0; i < belts.length && points.length < MAX_LOITER_POINTS; i += stride) {
    add(beside(belts[i].path[Math.floor(belts[i].path.length / 2)]))
  }
  loiterCache.set(map, points)
  return points
}

/**
 * Ambient life for a crew member at rest: every 20-40s, seeded, they walk to a
 * loiter point, linger a few seconds and walk back to their own seat. The seat
 * stays reserved throughout; a real event always wins, because `sendTo` clears
 * `wander` and the seat with it.
 */
function idle(map: HallMap, crew: Crew, clockMs: number): Crew {
  const seat = crew.restSeat === null ? undefined : map.restSeats[crew.restSeat]
  if (seat === undefined || crew.goal !== null || crew.path.length > 0) return crew
  const wander = crew.wander ?? null

  if (wander === 'back') return { ...crew, wander: null, idleAt: null }
  if (wander === 'out') {
    const idleAt = clockMs + seededSpan(crew.nodeId, clockMs, STROLL_LINGER_MS)
    return { ...crew, wander: 'there', idleAt }
  }
  if (wander === 'there') {
    if (clockMs < (crew.idleAt ?? 0)) return crew
    return { ...crew, goal: seat.tile, then: 'couch', settle: seat.facing, wander: 'back' }
  }

  if (crew.then !== 'couch') return crew
  if (crew.idleAt === undefined || crew.idleAt === null) {
    return { ...crew, idleAt: clockMs + seededSpan(crew.nodeId, clockMs, STROLL_EVERY_MS) }
  }
  if (clockMs < crew.idleAt) return crew
  const points = loiterPoints(map)
  if (points.length === 0) return { ...crew, idleAt: null }
  const spot =
    points[Math.floor(mulberry32(hashOf(crew.nodeId) ^ Math.floor(clockMs))() * points.length)]
  return { ...crew, goal: spot, then: 'idle', settle: null, wander: 'out', idleAt: null }
}

export function tick(world: World, dtMs: number): World {
  const dtSec = dtMs / 1000
  const clock = world.clockMs + dtMs
  const crew = world.crew.map((c) => idle(world.map, tickCrew(world.map, c, dtSec), clock))
  const crates = world.crates
    .map((crate) => tickCrate(world, crate, dtSec))
    .filter((crate): crate is Crate => crate !== null)
  const clockMs = world.clockMs + dtMs
  const live = world.verdicts.filter((v) => clockMs - v.at < VERDICT_MS)
  const verdicts = live.length === world.verdicts.length ? world.verdicts : live
  return { ...world, crew, crates, verdicts, clockMs }
}
