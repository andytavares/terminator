import { describe, it, expect } from 'vitest'
import { partialFake } from '../../../../tests/support/fakes'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  cratePosition,
  createWorld,
  tick,
  seatOf,
  nearestRestSeat,
  tileCenter,
  stationOf,
  workAnimFor,
  loiterPoints,
  VERDICT_MS,
} from '../../src/factory/sim.js'
import type { Crew, World } from '../../src/factory/sim.js'
import { tileOf } from '../../src/factory/sim.js'
import { direct } from '../../src/factory/director.js'
import { layoutHall } from '../../src/factory/layout.js'
import type { HallMap, RestSeat, Tile } from '../../src/factory/layout.js'
import { buildRunGraph, withNode } from '../../src/line/run-graph.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import type { Recipe } from '../../src/recipe/parse.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { RunGraph } from '../../src/line/run-graph.js'
import type { Observation } from '../../src/factory/events.js'
import { raiseGate } from '../../src/gates/rules.js'
import { findPath } from '../../src/factory/path.js'

// createWorld settles a run onto its floor with no motion at all: nothing
// walked in, it is simply where the run already is. tick is the only thing
// that ever moves a Crew or a Crate, and it does so deterministically — the
// same events replayed with the same tick sizes land in the same pixel.

const RECIPE = `
schemaVersion: 1
id: standard
steps:
  - id: a
    kind: agent
    role: builder
  - id: b
    kind: agent
    role: builder
    after: [a]
  - id: r
    kind: run
    command: echo hi
    after: [b]
  - id: g
    kind: gate
    rule: ready-for-review
    options: [mark_ready, hold]
    defaultIfIgnored: hold
    after: [r]
`

function order(): WorkOrder {
  return draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
}

function graph(): RunGraph {
  const parsed = parseRecipe(RECIPE, 'standard.yaml')
  if (!parsed.ok) throw new Error(parsed.reason)
  return buildRunGraph(order(), parsed.value)
}

function obs(g: RunGraph, over: Partial<Observation> = {}): Observation {
  return {
    graph: g,
    orphaned: [],
    stranded: [],
    waiting: [],
    activity: {},
    ci: null,
    queue: null,
    ...over,
  }
}

// Duplicated from tests/factory/layout.spec.ts: builds a real run graph from
// a shipped recipe file and a lane count, the same way that spec does.
const SHIPPED_RECIPES = path.join(__dirname, '..', '..', 'recipes')

function recipeFrom(file: string, dir = SHIPPED_RECIPES): Recipe {
  const text = fs.readFileSync(path.join(dir, file), 'utf-8')
  const parsed = parseRecipe(text, file)
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.value
}

function unit(id: string, lane: number): WorkOrder['plan']['units'][number] {
  return {
    id,
    title: id,
    role: 'builder',
    lane,
    dependsOn: [],
    satisfies: ['AC-1'],
    touches: [],
    verify: [],
  }
}

function orderFor(recipeId: string, lanes: number[]): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: lanes.map((n) => `/repos/${recipeId}-${n}`),
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    recipe: recipeId,
    risk: { ...base.risk, triggers: ['migration'] },
    plan: {
      ...base.plan,
      units: lanes.map((lane) => unit(`U-${lane}`, lane)),
      lanes: lanes.map((ord) => ({
        ord,
        repo: `repo-${ord}`,
        branch: '',
        role: null,
        blocks: [],
        blockedBy: [],
      })),
    },
  }
}

function graphFor(recipeFile: string, lanes: number[], dir = SHIPPED_RECIPES): RunGraph {
  const recipe = recipeFrom(recipeFile, dir)
  const order = orderFor(recipe.id, lanes)
  return buildRunGraph(order, recipe)
}

describe('workAnimFor', () => {
  it('scans at a rig and types everywhere else', () => {
    const map = layoutHall(graph())
    for (const prop of map.props) {
      if (prop.nodeId === null) continue
      const expected = prop.kind === 'rig' ? 'scan' : 'type'
      expect(workAnimFor(map, prop.nodeId)).toBe(expected)
    }
    expect(map.props.some((p) => p.kind === 'rig')).toBe(true)
    expect(map.props.some((p) => p.kind === 'desk')).toBe(true)
  })

  it('types for a node with no station', () => {
    expect(workAnimFor(layoutHall(graph()), 'nowhere')).toBe('type')
  })
})

describe('verdicts', () => {
  const verdict = { nodeId: 'a', pass: true, at: 0 }

  it('a new world has none', () => {
    const g = graph()
    expect(createWorld(layoutHall(g), obs(g)).verdicts).toEqual([])
  })

  it('tick keeps a verdict until VERDICT_MS and then drops it', () => {
    const g = graph()
    const world: World = { ...createWorld(layoutHall(g), obs(g)), verdicts: [verdict] }
    const before = tick(world, VERDICT_MS - 1)
    expect(before.verdicts).toEqual([verdict])
    expect(before.verdicts).toBe(world.verdicts)
    expect(tick(world, VERDICT_MS).verdicts).toEqual([])
  })
})

describe('createWorld: CI', () => {
  it('starts with no CI when the observation carries none', () => {
    const g = graph()
    const world = createWorld(layoutHall(g), obs(g))
    expect(world.ci).toBeNull()
  })

  it('carries the round and each check bucket the observation reports', () => {
    const g = graph()
    const world = createWorld(
      layoutHall(g),
      obs(g, {
        ci: {
          round: 2,
          max: 3,
          status: 'red',
          reason: '',
          at: '2026-09-06T10:00:00.000Z',
          pulls: [
            { url: 'u', checks: [{ name: 'test', bucket: 'fail', link: 'l', workflow: 'w' }] },
          ],
        },
      })
    )
    expect(world.ci).toEqual({ round: 2, max: 3, checks: { test: 'fail' } })
  })
})

describe('createWorld: queue', () => {
  it('starts with no queue when the observation carries none', () => {
    const g = graph()
    expect(createWorld(layoutHall(g), obs(g)).queue).toBeNull()
  })

  it('carries the position and who it is behind, by title, from the observation', () => {
    const g = graph()
    const world = createWorld(
      layoutHall(g),
      obs(g, { queue: { position: 3, behind: [{ orderId: 'WO-2', title: 'Other order' }] } })
    )
    expect(world.queue).toEqual({ position: 3, behind: ['Other order'] })
  })
})

describe('createWorld', () => {
  describe('running and failed nodes', runningAndFailedNodesTests)
  describe('resting nodes', restingNodesTests)
  describe('absent crew', absentCrewTests)
  describe('waiting gates', waitingGatesTests)
  describe('stationless and determinism', stationlessAndDeterminismTests)
  describe('distinct rest seats', distinctRestSeatsTests)
})

function runningAndFailedNodesTests() {
  it('settles a running node at its seat, doing its own kind of work', () => {
    const g = withNode(graph(), 'a', { state: 'running' })
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))
    const crew = world.crew.find((c) => c.nodeId === 'a')!
    expect(crew.anim).toBe('type')
    expect(crew.goal).toBe(null)
    expect(crew.path).toEqual([])
    const seat = seatOf(map, 'a')!
    expect({ x: crew.x, y: crew.y }).toEqual(tileCenter(seat))
  })

  it('settles a running run node scanning, not typing', () => {
    const g = withNode(graph(), 'r', { state: 'running' })
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))
    expect(world.crew.find((c) => c.nodeId === 'r')?.anim).toBe('scan')
  })

  it('settles a failed node slumped at its seat', () => {
    const g = withNode(graph(), 'a', { state: 'failed' })
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))
    expect(world.crew.find((c) => c.nodeId === 'a')?.anim).toBe('slump')
  })
}

function restingNodesTests() {
  it('settles a passed node seated in the breakroom, on the nearest free rest seat', () => {
    const g = withNode(graph(), 'a', { state: 'passed' })
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))
    const crew = world.crew.find((c) => c.nodeId === 'a')!
    expect(crew.anim).toBe('couch')
    expect(crew.restSeat).not.toBe(null)
    const expected = nearestRestSeat(map, seatOf(map, 'a')!, new Set())!
    expect(crew.restSeat).toBe(expected.id)
    expect(crew.facing).toBe(expected.facing)
    expect({ x: crew.x, y: crew.y }).toEqual(tileCenter(expected.tile))
  })

  it('a waiting node sits in the breakroom too, seated rather than idle', () => {
    const g = graph() // 'b' depends on 'a', starts 'waiting'
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))
    const crew = world.crew.find((c) => c.nodeId === 'b')!
    expect(crew.anim).toBe('couch')
    expect(crew.restSeat).not.toBe(null)
  })
}

function absentCrewTests() {
  it('an orphaned node is not present', () => {
    const g = withNode(graph(), 'a', { state: 'running' })
    const map = layoutHall(g)
    const world = createWorld(map, obs(g, { orphaned: ['a'] }))
    const crew = world.crew.find((c) => c.nodeId === 'a')
    expect(crew?.present).toBe(false)
  })

  it('a gate node with no role or working kind gets no crew of its own', () => {
    const g = graph()
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))
    expect(world.crew.some((c) => c.nodeId === 'g')).toBe(false)
  })
}

function waitingGatesTests() {
  it('gatesWaiting is empty unless a gate is waiting', () => {
    const g = graph()
    const map = layoutHall(g)
    expect(createWorld(map, obs(g)).gatesWaiting).toEqual([])

    const raised = raiseGate({
      id: 'gate-1',
      rule: 'unit.boundary',
      orderId: 'WO-1',
      nodeId: 'g',
      summary: 's',
      why: 'w',
      at: '2026-09-06T10:00:00.000Z',
    })
    expect(createWorld(map, obs(g, { waiting: [raised] })).gatesWaiting).toEqual(['g'])
  })
}

function stationlessAndDeterminismTests() {
  it('a waiting node with no station in the map gets no crew of its own', () => {
    const g = withNode(graph(), 'b', { state: 'waiting' })
    const mapMissingB = layoutHall({ ...g, nodes: g.nodes.filter((n) => n.id !== 'b') })
    const world = createWorld(mapMissingB, obs(g))
    expect(world.crew.some((c) => c.nodeId === 'b')).toBe(false)
  })

  it('two calls on the same graph settle deep-equal worlds', () => {
    const g = withNode(graph(), 'a', { state: 'running' })
    const map = layoutHall(g)
    expect(createWorld(map, obs(g))).toEqual(createWorld(map, obs(g)))
  })
}

function distinctRestSeatsTests() {
  it('all-passed gives every idle crew member a distinct rest seat', () => {
    const g0 = graphFor('standard.yaml', [1, 2, 3])
    let g = g0
    for (const node of g0.nodes) g = withNode(g, node.id, { state: 'passed' })
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))
    expect(world.crew.length).toBeGreaterThan(0)
    const seatIds = world.crew.map((c) => c.restSeat)
    expect(seatIds.every((id) => id !== null)).toBe(true)
    expect(new Set(seatIds).size).toBe(seatIds.length)
  })
}

describe('nearestRestSeat', () => {
  describe('distance and ties', distanceAndTiesTests)
  describe('full benches', fullBenchesTests)
  describe('two crew', twoCrewTests)
})

function distanceAndTiesTests() {
  it('picks the free seat with the shortest walk, not the lower id, when the two disagree', () => {
    // A two-row strip: row 0 has two seats at x=2 and x=4 (both blocked in
    // `walk`, as a real seat is until it is taken); row 1 is a clear detour
    // around them. Seat 2 is reachable in 2 steps; seat 4 only by detouring
    // through row 1, in 6. The nearer seat is given the *higher* id, so a
    // buggy "lowest id wins" implementation would return the wrong one.
    const rowBlocked = [false, false, true, false, true, false]
    const rowOpen = [false, false, false, false, false, false]
    const map = {
      walk: [rowBlocked, rowOpen],
      restSeats: [
        { id: 1, tile: { x: 4, y: 0 }, facing: 'S', propId: 'far' },
        { id: 7, tile: { x: 2, y: 0 }, facing: 'N', propId: 'near' },
      ] as RestSeat[],
    } as unknown as HallMap
    const seat = nearestRestSeat(map, { x: 0, y: 0 }, new Set())
    expect(seat?.id).toBe(7)
  })

  it('breaks an exact tie in walk distance by the lower seat id', () => {
    // `map.restSeats` is always generated in ascending id order, and the
    // comparison is a strict `<`, so the earlier (lower-id) seat of an exact
    // tie is the one kept.
    const row = [false, false, true, false, true]
    const map = {
      walk: [row],
      restSeats: [
        { id: 3, tile: { x: 2, y: 0 }, facing: 'N', propId: 'left' },
        { id: 9, tile: { x: 4, y: 0 }, facing: 'S', propId: 'right' },
      ] as RestSeat[],
    } as unknown as HallMap
    // Both seats are equidistant (1 step) from x=3 in a single-row corridor.
    const seat = nearestRestSeat(map, { x: 3, y: 0 }, new Set())
    expect(seat?.id).toBe(3)
  })
}

function fullBenchesTests() {
  it('returns null when every seat is taken', () => {
    const row = [false, false, true]
    const map = {
      walk: [row],
      restSeats: [{ id: 0, tile: { x: 2, y: 0 }, facing: 'S', propId: 'only' }] as RestSeat[],
    } as unknown as HallMap
    expect(nearestRestSeat(map, { x: 0, y: 0 }, new Set([0]))).toBe(null)
  })
}

function twoCrewTests() {
  it('two crew going idle one after another land on different seats', () => {
    const g = graphFor('standard.yaml', [1, 2, 3])
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))

    let next = direct(
      world,
      [{ kind: 'node-state', nodeId: 'document', from: 'running', to: 'passed' }],
      0
    )
    const documentSeat = next.crew.find((c) => c.nodeId === 'document')!.restSeat
    next = direct(
      next,
      [{ kind: 'node-state', nodeId: 'verify', from: 'running', to: 'passed' }],
      0
    )
    const verifySeat = next.crew.find((c) => c.nodeId === 'verify')!.restSeat
    expect(documentSeat).not.toBe(null)
    expect(verifySeat).not.toBe(null)
    expect(documentSeat).not.toBe(verifySeat)
  })
}

describe('breakroom walk paths', () => {
  it('walks from each station seat to its rest seat without crossing an unopened belt tile', () => {
    const g0 = graphFor('standard.yaml', [1, 2, 3])
    let g = g0
    for (const node of g0.nodes) g = withNode(g, node.id, { state: 'passed' })
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))

    const beltTileKeys = new Set(map.beltTiles.map((t) => `${t.x},${t.y}`))
    const crossoverKeys = new Set(map.crossovers.map((t) => `${t.x},${t.y}`))
    const restSeatById = new Map(map.restSeats.map((s) => [s.id, s]))

    let checked = 0
    for (const crew of world.crew) {
      if (crew.restSeat === null) continue
      const stationSeat = seatOf(map, crew.nodeId)
      if (stationSeat === null) continue
      const seat = restSeatById.get(crew.restSeat) as RestSeat
      const walked = findPath(map.walk, { from: stationSeat, to: seat.tile })
      expect(walked.length).toBeGreaterThan(0)
      for (const tile of walked) {
        const key = `${tile.x},${tile.y}`
        if (beltTileKeys.has(key)) expect(crossoverKeys.has(key)).toBe(true)
      }
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('tick', () => {
  describe('walking', walkingTests)
  describe('arriving', arrivingTests)
  describe('rest seat facing', restSeatFacingTests)
  describe('releasing seats', releasingSeatsTests)
  describe('crates', cratesTests)
  describe('queued work and unknown belts', queuedWorkAndUnknownBeltsTests)
  describe('the clock and replays', theClockAndReplaysTests)
  describe('empty paths', emptyPathsTests)
})

function walkingTests() {
  it('advances a walking crew member toward a goal and does not move one with none', () => {
    const g = graph()
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))
    const before = world.crew.find((c) => c.nodeId === 'a')!
    const stationTile = stationOf(map, 'a')!
    const goal = { x: stationTile.x, y: stationTile.y }
    const withGoal: World = {
      ...world,
      crew: world.crew.map((c) => (c.nodeId === 'a' ? { ...c, goal, then: 'type' } : c)),
    }
    const after = tick(withGoal, 16)
    const crewAfter = after.crew.find((c) => c.nodeId === 'a')!
    expect(crewAfter.anim).toBe('walk')
    expect(crewAfter.x !== before.x || crewAfter.y !== before.y).toBe(true)

    // a crew member with no goal never moves
    const idle = world.crew.find((c) => c.nodeId === 'b')!
    const idleAfter = tick(world, 16).crew.find((c) => c.nodeId === 'b')!
    expect(idleAfter.x).toBe(idle.x)
    expect(idleAfter.y).toBe(idle.y)
  })
}

function arrivingTests() {
  it('walks all the way to the seat and adopts the arrival animation, ticking in 16ms steps', () => {
    const g = graph()
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))
    const seat = seatOf(map, 'b')!
    let w: World = {
      ...world,
      crew: world.crew.map((c) => (c.nodeId === 'b' ? { ...c, goal: seat, then: 'type' } : c)),
    }
    for (let elapsed = 0; elapsed < 30_000; elapsed += 16) w = tick(w, 16)
    const crew = w.crew.find((c) => c.nodeId === 'b')!
    const center = tileCenter(seat)
    expect(crew.x).toBe(center.x)
    expect(crew.y).toBe(center.y)
    expect(crew.anim).toBe('type')
    expect(crew.goal).toBe(null)
    expect(crew.path).toEqual([])
  })
}

function restSeatFacingTests() {
  it('arrives at a rest seat facing the way the seat faces', () => {
    const g = graphFor('standard.yaml', [1, 2, 3])
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))
    const next = direct(
      world,
      [{ kind: 'node-state', nodeId: 'document', from: 'running', to: 'passed' }],
      0
    )
    let w = next
    for (let elapsed = 0; elapsed < 30_000 && w.crew.find((c) => c.nodeId === 'document')!.goal; ) {
      w = tick(w, 16)
      elapsed += 16
    }
    const crew = w.crew.find((c) => c.nodeId === 'document')!
    expect(crew.goal).toBe(null)
    const seat = map.restSeats.find((s) => s.id === crew.restSeat)!
    expect(crew.facing).toBe(seat.facing)
  })
}

function releasingSeatsTests() {
  it('releases its seat when sent back to work, and a later idle crew member can take it', () => {
    const g = graphFor('standard.yaml', [1, 2, 3])
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))

    let w = direct(
      world,
      [{ kind: 'node-state', nodeId: 'document', from: 'running', to: 'passed' }],
      0
    )
    const seatId = w.crew.find((c) => c.nodeId === 'document')!.restSeat
    expect(seatId).not.toBe(null)

    w = direct(w, [{ kind: 'node-state', nodeId: 'document', from: 'passed', to: 'running' }], 0)
    expect(w.crew.find((c) => c.nodeId === 'document')!.restSeat).toBe(null)

    // Nothing holds it any more, so a crew member looking for a seat is given
    // it once every other seat is taken.
    const taken = new Set(w.crew.map((c) => c.restSeat).filter((id): id is number => id !== null))
    expect(taken.has(seatId!)).toBe(false)
    const freed = map.restSeats.find((s) => s.id === seatId)!
    const everyOther = new Set(map.restSeats.filter((s) => s.id !== seatId).map((s) => s.id))
    expect(nearestRestSeat(map, freed.tile, everyOther)?.id).toBe(seatId)
  })
}

function cratesTests() {
  it('a crate bound for a started step advances and is consumed on arrival', () => {
    const g = graph()
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))
    expect(world.crates).toEqual([])

    const belt = map.belts[0]
    expect(belt).toBeDefined()
    let w: World = { ...world, crates: [{ id: 'c1', beltId: belt.id, progress: 0, parks: false }] }
    w = tick(w, 100)
    expect(w.crates).toHaveLength(1)
    expect(w.crates[0].progress).toBeGreaterThan(0)
    expect(w.crates[0].progress).toBeLessThan(1)

    // enough time that it must have arrived
    for (let i = 0; i < 50; i++) w = tick(w, 1000)
    expect(w.crates).toEqual([])
  })

  it('a crate bound for a step that has not started parks at the end of the belt', () => {
    const g = graph()
    const map = layoutHall(g)
    const belt = map.belts[0]
    let w: World = {
      ...createWorld(map, obs(g)),
      crates: [{ id: 'c1', beltId: belt.id, progress: 0, parks: true }],
    }
    for (let i = 0; i < 50; i++) w = tick(w, 1000)
    expect(w.crates).toEqual([{ id: 'c1', beltId: belt.id, progress: 1, parks: true }])
  })
}

function queuedWorkAndUnknownBeltsTests() {
  it('shows work already queued on first load: a parked crate per finished-but-unstarted edge', () => {
    const g = graph()
    const belt = layoutHall(g).belts[0]
    const queued = withNode(g, belt.fromNodeId, { state: 'passed' })
    const world = createWorld(layoutHall(queued), obs(queued))
    expect(world.crates).toContainEqual({
      id: `${belt.id}@queued`,
      beltId: belt.id,
      progress: 1,
      parks: true,
    })
    // nothing queued where nothing has finished
    expect(createWorld(layoutHall(g), obs(g)).crates).toEqual([])
  })

  it('a crate on an unknown belt id still advances, using a default distance', () => {
    const g = graph()
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))
    let w: World = {
      ...world,
      crates: [{ id: 'c1', beltId: 'no-such-belt', progress: 0, parks: false }],
    }
    w = tick(w, 100)
    expect(w.crates[0].progress).toBeGreaterThan(0)
  })
}

function theClockAndReplaysTests() {
  it('advances the clock deterministically', () => {
    const g = graph()
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))
    const after = tick(world, 250)
    expect(after.clockMs).toBe(250)
  })

  it('two identical replays land in the same place', () => {
    const g = graph()
    const map = layoutHall(g)
    const seat = seatOf(map, 'b')!
    function run(): World {
      const world = createWorld(map, obs(g))
      let w: World = {
        ...world,
        crew: world.crew.map((c) => (c.nodeId === 'b' ? { ...c, goal: seat, then: 'type' } : c)),
      }
      for (let elapsed = 0; elapsed < 5000; elapsed += 16) w = tick(w, 16)
      return w
    }
    expect(run()).toEqual(run())
  })
}

function emptyPathsTests() {
  it('a crew member with a goal but an already-empty path that resolves to no route arrives immediately', () => {
    // Build a world where the crew's own tile is already the goal.
    const g = graph()
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))
    const crew = world.crew.find((c) => c.nodeId === 'a')!
    const here = { x: Math.round((crew.x - 8) / 16), y: Math.round((crew.y - 12) / 16) }
    const w: World = {
      ...world,
      crew: world.crew.map((c) => (c.nodeId === 'a' ? { ...c, goal: here, then: 'wave' } : c)),
    }
    const after = tick(w, 16).crew.find((c) => c.nodeId === 'a')!
    expect(after.goal).toBe(null)
    expect(after.anim).toBe('wave')
  })
}

describe('cratePosition', () => {
  const belt = {
    id: 'a->b',
    fromNodeId: 'a',
    toNodeId: 'b',
    path: [
      { x: 1, y: 5 },
      { x: 2, y: 5 },
      { x: 3, y: 5 },
      { x: 3, y: 4 },
    ],
  }

  it('starts on the first tile and glides between tiles rather than jumping', () => {
    expect(cratePosition(belt, 0)).toEqual({ x: 1 * 16 + 8, y: 5 * 16 + 10 })
    const quarter = cratePosition(belt, 0.25)
    expect(quarter.x).toBeGreaterThan(1 * 16 + 8)
    expect(quarter.x).toBeLessThan(2 * 16 + 8)
  })

  it("at progress 1 sits at the last path tile's centre (+8, +10)", () => {
    expect(cratePosition(belt, 1)).toEqual({ x: 3 * 16 + 8, y: 4 * 16 + 10 })
  })

  it('stays on the only tile of a one-tile belt', () => {
    const short = { ...belt, path: [{ x: 4, y: 4 }] }
    expect(cratePosition(short, 0.5)).toEqual({ x: 4 * 16 + 8, y: 4 * 16 + 10 })
  })
})

function restingWorld(): World {
  let g = graphFor('standard.yaml', [1, 2])
  for (const node of g.nodes) g = withNode(g, node.id, { state: 'passed' })
  return createWorld(layoutHall(g), obs(g))
}
function runFor(world: World, ms: number, step = 100): World {
  let w = world
  for (let t = 0; t < ms; t += step) w = tick(w, step)
  return w
}
function trail(world: World, ms: number): string[] {
  const out: string[] = []
  let w = world
  for (let t = 0; t < ms; t += 100) {
    w = tick(w, 100)
    out.push(w.crew.map((c) => `${Math.round(c.x)},${Math.round(c.y)}`).join('|'))
  }
  return out
}

describe('idle crew wander', () => {
  describe('loiter points', loiterPointsTests)
  describe('strolling', strollingTests)
  describe('determinism and overrides', determinismAndOverridesTests)
})

// One-tile corridor along row 1 with a bay under x=3 and x=7 where someone
// can stand aside. Only `walk` is read by the crew's movement.
const ROWS = ['#########', '.........', '###.###.#', '#########']
const walk = ROWS.map((row) => row.split('').map((ch) => ch === '#'))
const corridor = partialFake<HallMap>({ walk, solid: walk, restSeats: [], props: [] })
/** A crew member of `nodeId` walking `from` one tile to its `goal`, to `then` there. */
function member(
  nodeId: string,
  { from, goal }: { from: { x: number; y: number }; goal: { x: number; y: number } },
  then: Crew['then']
): Crew {
  const c = tileCenter(from)
  return {
    nodeId,
    role: null,
    x: c.x,
    y: c.y,
    facing: 'E',
    anim: 'idle',
    path: [],
    goal,
    then,
    present: true,
    restSeat: null,
    settle: null,
  }
}
function world(crew: Crew[]): World {
  return {
    map: corridor,
    crew,
    crates: [],
    gatesWaiting: [],
    openCalls: [],
    verdicts: [],
    clockMs: 0,
    ci: null,
    queue: null,
  }
}
function atGoal(c: Crew): boolean {
  const t = tileOf(c.x, c.y)
  return c.goal === null && c.path.length === 0 && t.x >= 0
}
function run(start: World, ticks: number, onTick?: (w: World) => void): World {
  let w = start
  for (let i = 0; i < ticks && !w.crew.every(atGoal); i++) {
    w = tick(w, 16)
    onTick?.(w)
  }
  return w
}
function sharedTile(w: World): string | null {
  const seen = new Set<string>()
  for (const c of w.crew.filter((m) => m.present)) {
    const t = tileOf(c.x, c.y)
    const k = `${t.x},${t.y}`
    if (seen.has(k)) return k
    seen.add(k)
  }
  return null
}

/** Runs `start`, keeping every tile two present crew members stood on at once. */
function runWatchingOverlap(start: World, ticks: number): { end: World; shared: string[] } {
  const shared: string[] = []
  const end = run(start, ticks, (w) => {
    const k = sharedTile(w)
    if (k !== null) shared.push(k)
  })
  return { end, shared }
}

/** Every world `start` passes through in `count` ticks of 16 ms. */
function ticked(start: World, count: number): World[] {
  const worlds: World[] = []
  let w = start
  for (let i = 0; i < count; i++) {
    w = tick(w, 16)
    worlds.push(w)
  }
  return worlds
}

// A corridor with a 3x3 room in the middle to pass in.
const ROOM = [
  '#############',
  '#####...#####',
  '.............',
  '#####...#####',
  '#############',
].map((row) => row.split('').map((ch) => ch === '#'))
const room = partialFake<HallMap>({ walk: ROOM, solid: ROOM, restSeats: [], props: [] })

function loiterPointsTests() {
  it('picks loiter points from the map alone: free, reachable floor, in a fixed order', () => {
    const map = restingWorld().map
    const points = loiterPoints(map)
    expect(points.length).toBeGreaterThan(0)
    expect(points.length).toBeLessThanOrEqual(8)
    for (const p of points) expect(map.walk[p.y][p.x]).toBe(false)
    expect(loiterPoints(map)).toBe(points)
  })

  it('leaves everyone seated before the first stroll is due', () => {
    const start = restingWorld()
    const after = runFor(start, 19_000)
    expect(after.crew.map((c) => [c.x, c.y])).toEqual(start.crew.map((c) => [c.x, c.y]))
  })
}

function strollingTests() {
  it('sends a resting crew member to a loiter point and back to their own seat', () => {
    const start = restingWorld()
    const seats = start.crew.map((c) => c.restSeat)
    let w = start
    let walked = false
    let left = false
    for (let t = 0; t < 120_000; t += 100) {
      w = tick(w, 100)
      for (const c of w.crew) {
        if (c.wander === 'out' || c.wander === 'back') walked = true
        if (c.wander !== null && c.wander !== undefined) {
          // the seat stays reserved for the whole stroll
          expect(c.restSeat).not.toBeNull()
        }
      }
      if (w.crew.some((c) => c.wander === 'there')) left = true
    }
    expect(walked).toBe(true)
    expect(left).toBe(true)
    // after enough time everyone has either come home or is out strolling
    const homeAgain = runFor(w, 120_000).crew.filter((c) => c.goal === null && c.wander == null)
    for (const c of homeAgain) {
      const seat = start.map.restSeats[c.restSeat as number]
      expect([c.x, c.y]).toEqual([tileCenter(seat.tile).x, tileCenter(seat.tile).y])
    }
    expect(w.crew.map((c) => c.restSeat)).toEqual(seats)
  })
}

function determinismAndOverridesTests() {
  it('is deterministic: the same world and tick sizes walk the same path', () => {
    expect(trail(restingWorld(), 90_000)).toEqual(trail(restingWorld(), 90_000))
  })

  it('lets a real node-state event override a stroll', () => {
    let w = restingWorld()
    let strolling: string | undefined
    for (let t = 0; t < 120_000 && strolling === undefined; t += 100) {
      w = tick(w, 100)
      strolling = w.crew.find((c) => c.wander === 'out')?.nodeId
    }
    expect(strolling).toBeDefined()
    const id = strolling as string
    w = direct(w, [{ kind: 'node-state', nodeId: id, from: 'passed', to: 'running' }], w.clockMs)
    const crew = w.crew.find((c) => c.nodeId === id)!
    expect(crew.wander).toBeNull()
    expect(crew.restSeat).toBeNull()
    expect(crew.goal).toEqual(seatOf(w.map, id))
    // and it stays on its errand: never pulled back into a stroll
    const later = run(w, 60_000).crew.find((c) => c.nodeId === id)!
    expect(later.wander ?? null).toBeNull()
    expect(later.anim).not.toBe('couch')
  })
}

describe('crew are solid', () => {
  describe('head-on', headOnTests)
  describe('a passing place', aPassingPlaceTests)
  describe('absent crew and determinism', absentCrewAndDeterminismTests)
  describe('a dead end', aDeadEndTests)
})

// A one-tile corridor closed at its west end, with `c` standing at the end of it.
const DEAD_END = ['#####', '#....', '#####'].map((row) => row.split('').map((ch) => ch === '#'))
const deadEnd = partialFake<HallMap>({ walk: DEAD_END, solid: DEAD_END, restSeats: [], props: [] })

/** `b`, bound for a rest, between `c` and `a`; `a`, bound for work past them both. */
function hemmedIn(): World {
  const c = { ...member('c', { from: { x: 1, y: 1 }, goal: { x: 1, y: 1 } }, 'idle'), goal: null }
  return {
    ...world([
      c,
      member('b', { from: { x: 2, y: 1 }, goal: { x: 4, y: 1 } }, 'couch'),
      member('a', { from: { x: 3, y: 1 }, goal: { x: 1, y: 1 } }, 'type'),
    ]),
    map: deadEnd,
  }
}

const tileOfCrew = (w: World, id: string): Tile => tileOf(crewOf(w, id).x, crewOf(w, id).y)

function aDeadEndTests() {
  it('the one giving way, with nowhere to step aside or back, waits where it stands', () => {
    const worlds = ticked(hemmedIn(), 40)
    for (const w of worlds) {
      expect(sharedTile(w)).toBeNull()
      expect(tileOfCrew(w, 'b')).toEqual({ x: 2, y: 1 })
    }
    const b = crewOf(worlds[worlds.length - 1], 'b')
    expect(b.anim).toBe('idle')
    expect(b.blockedMs).toBeGreaterThan(0)
  })

  it('the one who outranks, stuck behind someone stuck too, backs off to make room', () => {
    const worlds = ticked(hemmedIn(), 100)
    for (const w of worlds.filter((v) => v.clockMs <= 800)) expect(tileOfCrew(w, 'a').x).toBe(3)
    expect(worlds.some((w) => tileOfCrew(w, 'a').x === 4)).toBe(true)
    for (const w of worlds) expect(sharedTile(w)).toBeNull()
  })
}

const realGraph = (): RunGraph =>
  JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'run-graph-real.json'), 'utf-8')
  ) as RunGraph
const crewOf = (world: World, id: string): Crew => world.crew.find((c) => c.nodeId === id)!
const settled = (): World => {
  const g = realGraph()
  return createWorld(layoutHall(g), {
    graph: g,
    orphaned: [],
    stranded: [],
    waiting: [],
    activity: {},
    ci: null,
    queue: null,
  })
}
const sendBack = (toNodeId: string): World =>
  direct(settled(), [{ kind: 'rework', fromNodeId: 'verify', toNodeId, round: 1 }], 0)

function headOnTests() {
  it('two crew sent head-on never share a tile and both arrive', () => {
    const start = world([
      member('a', { from: { x: 0, y: 1 }, goal: { x: 8, y: 1 } }, 'type'),
      member('b', { from: { x: 8, y: 1 }, goal: { x: 0, y: 1 } }, 'couch'),
    ])
    const { end, shared } = runWatchingOverlap(start, 3000)
    expect(shared).toEqual([])
    expect(end.crew.map((c) => [c.goal, tileOf(c.x, c.y)])).toEqual([
      [null, { x: 8, y: 1 }],
      [null, { x: 0, y: 1 }],
    ])
  })
}

function aPassingPlaceTests() {
  it('four crew sent both ways through one passing place all arrive', () => {
    // All four end in the room, so nobody ends up parked in the corridor itself.
    const start = {
      ...world([
        member('a', { from: { x: 0, y: 2 }, goal: { x: 7, y: 3 } }, 'type'),
        member('b', { from: { x: 12, y: 2 }, goal: { x: 5, y: 1 } }, 'type'),
        member('c', { from: { x: 1, y: 2 }, goal: { x: 6, y: 3 } }, 'couch'),
        member('d', { from: { x: 11, y: 2 }, goal: { x: 6, y: 1 } }, 'couch'),
      ]),
      map: room,
    }
    const { end, shared } = runWatchingOverlap(start, 3000)
    expect(shared).toEqual([])
    expect(end.crew.every((c) => c.goal === null && c.path.length === 0)).toBe(true)
    expect(end.crew.map((c) => tileOf(c.x, c.y))).toEqual([
      { x: 7, y: 3 },
      { x: 5, y: 1 },
      { x: 6, y: 3 },
      { x: 6, y: 1 },
    ])
  })
}

function absentCrewAndDeterminismTests() {
  it('a crew member who is not present does not block anyone', () => {
    const away = {
      ...member('away', { from: { x: 4, y: 1 }, goal: { x: 4, y: 1 } }, 'idle'),
      goal: null,
      present: false,
    }
    const end = run(
      world([member('a', { from: { x: 0, y: 1 }, goal: { x: 8, y: 1 } }, 'type'), away]),
      1000
    )
    expect(tileOf(end.crew[0].x, end.crew[0].y)).toEqual({ x: 8, y: 1 })
  })

  it('ticks twice to identical worlds', () => {
    const make = (): World =>
      world([
        member('a', { from: { x: 0, y: 1 }, goal: { x: 8, y: 1 } }, 'type'),
        member('b', { from: { x: 8, y: 1 }, goal: { x: 0, y: 1 } }, 'couch'),
      ])
    expect(ticked(make(), 600)).toEqual(ticked(make(), 600))
  })
}

describe('tick: a box carried back to an earlier station', () => {
  describe('carrying the box', carryingTheBoxTests)
  describe('cancelled errands', cancelledErrandsTests)
})

/**
 * Ticks until the verifier's errand is over, failing the moment two present
 * crew members share a tile, and says whether it carried the box on the way.
 */
function walkTheErrand(start: World): { world: World; carried: boolean } {
  let world = start
  let carried = false
  for (let i = 0; i < 4000 && crewOf(world, 'verify').errand !== undefined; i++) {
    world = tick(world, 50)
    carried ||= crewOf(world, 'verify').carrying === true
    expect(sharedTile(world)).toBeNull()
  }
  return { world, carried }
}

function carryingTheBoxTests() {
  it.each([
    ['build:lane-1', 0],
    ['lint', 1],
  ])('carries the box to %s and walks home without overlap (%i crate parked)', (target, parked) => {
    const at = crewOf(settled(), 'verify')
    const home = tileOf(at.x, at.y)
    const homeAnim = at.anim
    const walked = walkTheErrand(sendBack(target))
    let world = walked.world
    for (let i = 0; i < 400; i++) world = tick(world, 50)
    const verifier = crewOf(world, 'verify')
    expect(walked.carried).toBe(true)
    expect(verifier.errand).toBeUndefined()
    expect(verifier.carrying).toBe(false)
    expect(tileOf(verifier.x, verifier.y)).toEqual(home)
    expect(verifier.anim).toBe(homeAnim)
    const dropped = world.crates.filter((c) => c.id.endsWith(':carried'))
    expect(dropped).toHaveLength(parked)
    for (const crate of dropped) {
      const into = world.map.belts.find((b) => b.id === crate.beltId)!
      expect(into.toNodeId).toBe(target)
      expect(crate).toMatchObject({ progress: 1, parks: true })
    }
  })
}

function cancelledErrandsTests() {
  it('cancels the errand when a real event sends the walker elsewhere', () => {
    let world = sendBack('build:lane-1')
    for (let i = 0; i < 5; i++) world = tick(world, 50)
    expect(crewOf(world, 'verify').carrying).toBe(true)
    world = direct(
      world,
      [{ kind: 'node-state', nodeId: 'verify', from: 'failed', to: 'running' }],
      world.clockMs
    )
    const verifier = crewOf(world, 'verify')
    expect(verifier.errand).toBeUndefined()
    expect(verifier.carrying).toBe(false)
  })
}
