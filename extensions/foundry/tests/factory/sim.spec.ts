import { describe, it, expect } from 'vitest'
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
} from '../../src/factory/sim.js'
import type { World } from '../../src/factory/sim.js'
import { direct } from '../../src/factory/director.js'
import { layoutHall } from '../../src/factory/layout.js'
import type { HallMap, RestSeat } from '../../src/factory/layout.js'
import { buildRunGraph, withNode } from '../../src/line/run-graph.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import type { Recipe } from '../../src/recipe/parse.js'
import { draftOrder } from '../../src/order/schema.js'
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
  return { graph: g, orphaned: [], stranded: [], waiting: [], activity: {}, ...over }
}

// Duplicated from tests/factory/layout.spec.ts: builds a real run graph from
// a shipped recipe file and a lane count, the same way that spec does, so
// the golden crew fixture below is exercised against the exact graph the
// prototype was run against.
const SHIPPED_RECIPES = path.join(__dirname, '..', '..', 'recipes')
// The recipes the prototype's golden output was recorded against. The shipped
// ones change as shapes gain steps; the recording cannot be re-run.
const RECORDED_RECIPES = path.join(__dirname, 'fixtures', 'recipes')

function recipeFrom(file: string, dir = SHIPPED_RECIPES): Recipe {
  const text = fs.readFileSync(path.join(dir, file), 'utf-8')
  const parsed = parseRecipe(text, file)
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.value
}

function unit(
  id: string,
  lane: number,
  dependsOn: string[] = [],
  role = 'builder'
): WorkOrder['plan']['units'][number] {
  return { id, title: id, role, lane, dependsOn, satisfies: ['AC-1'], touches: [], verify: [] }
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
    risk: { ...base.risk, triggers: ['db_migration'] },
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

describe('createWorld', () => {
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

  it('a ready node with no station in the map gets no crew of its own', () => {
    const g = withNode(graph(), 'b', { state: 'ready' })
    const mapMissingB = layoutHall({ ...g, nodes: g.nodes.filter((n) => n.id !== 'b') })
    const world = createWorld(mapMissingB, obs(g))
    expect(world.crew.some((c) => c.nodeId === 'b')).toBe(false)
  })

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
})

describe('nearestRestSeat', () => {
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

  it('returns null when every seat is taken', () => {
    const row = [false, false, true]
    const map = {
      walk: [row],
      restSeats: [{ id: 0, tile: { x: 2, y: 0 }, facing: 'S', propId: 'only' }] as RestSeat[],
    } as unknown as HallMap
    expect(nearestRestSeat(map, { x: 0, y: 0 }, new Set([0]))).toBe(null)
  })

  it('two crew going idle one after another land on different seats', () => {
    const g = graphFor('standard.yaml', [1, 2, 3])
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))

    let next = direct(
      world,
      [{ kind: 'node-state', nodeId: 'scout', from: 'running', to: 'passed' }],
      0
    )
    const scoutSeat = next.crew.find((c) => c.nodeId === 'scout')!.restSeat
    next = direct(
      next,
      [{ kind: 'node-state', nodeId: 'challenge', from: 'running', to: 'passed' }],
      0
    )
    const challengeSeat = next.crew.find((c) => c.nodeId === 'challenge')!.restSeat
    expect(scoutSeat).not.toBe(null)
    expect(challengeSeat).not.toBe(null)
    expect(scoutSeat).not.toBe(challengeSeat)
  })
})

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
      const walked = findPath(map.walk, stationSeat, seat.tile)
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

  it('arrives at a rest seat facing the way the seat faces', () => {
    const g = graphFor('standard.yaml', [1, 2, 3])
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))
    const next = direct(
      world,
      [{ kind: 'node-state', nodeId: 'scout', from: 'running', to: 'passed' }],
      0
    )
    let w = next
    for (let elapsed = 0; elapsed < 30_000 && w.crew.find((c) => c.nodeId === 'scout')!.goal; ) {
      w = tick(w, 16)
      elapsed += 16
    }
    const crew = w.crew.find((c) => c.nodeId === 'scout')!
    expect(crew.goal).toBe(null)
    const seat = map.restSeats.find((s) => s.id === crew.restSeat)!
    expect(crew.facing).toBe(seat.facing)
  })

  it('releases its seat when sent back to work, and a later idle crew member can take it', () => {
    const g = graphFor('standard.yaml', [1, 2, 3])
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))

    let w = direct(
      world,
      [{ kind: 'node-state', nodeId: 'scout', from: 'running', to: 'passed' }],
      0
    )
    const seatId = w.crew.find((c) => c.nodeId === 'scout')!.restSeat
    expect(seatId).not.toBe(null)

    w = direct(w, [{ kind: 'node-state', nodeId: 'scout', from: 'passed', to: 'running' }], 0)
    expect(w.crew.find((c) => c.nodeId === 'scout')!.restSeat).toBe(null)

    w = direct(w, [{ kind: 'node-state', nodeId: 'challenge', from: 'running', to: 'passed' }], 0)
    expect(w.crew.find((c) => c.nodeId === 'challenge')!.restSeat).toBe(seatId)
  })

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
})

describe('createWorld — golden crew', () => {
  const goldenPath = path.join(__dirname, 'fixtures', 'hall-golden.json')
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf-8')) as {
    crew: { initial: unknown; afterIdle: unknown; allPassed: unknown }
  }

  function project(world: World): unknown {
    return world.crew.map((c) => ({
      nodeId: c.nodeId,
      x: c.x,
      y: c.y,
      facing: c.facing,
      anim: c.anim,
    }))
  }

  it("matches the prototype's initial placement, idle-settle sequence and all-passed layout", () => {
    let g0 = graphFor('standard.yaml', [1, 2, 3], RECORDED_RECIPES)
    for (const id of ['scout', 'challenge', 'build:lane-1', 'build:lane-2', 'build:lane-3']) {
      g0 = withNode(g0, id, { state: 'running' })
    }
    const map = layoutHall(g0)

    const initialWorld = createWorld(map, obs(g0))
    expect(project(initialWorld)).toEqual(golden.crew.initial)

    let world = initialWorld
    for (const nodeId of ['scout', 'challenge', 'build:lane-2']) {
      world = direct(
        world,
        [{ kind: 'node-state', nodeId, from: 'running', to: 'passed' }],
        world.clockMs
      )
      let guard = 0
      while (world.crew.find((c) => c.nodeId === nodeId)!.goal !== null && guard < 10_000) {
        world = tick(world, 16)
        guard++
      }
      expect(guard).toBeLessThan(10_000)
    }
    expect(project(world)).toEqual(golden.crew.afterIdle)

    let allPassed = graphFor('standard.yaml', [1, 2, 3], RECORDED_RECIPES)
    for (const node of allPassed.nodes)
      allPassed = withNode(allPassed, node.id, { state: 'passed' })
    const allPassedWorld = createWorld(layoutHall(allPassed), obs(allPassed))
    expect(project(allPassedWorld)).toEqual(golden.crew.allPassed)
  })
})

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
