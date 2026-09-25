import { describe, it, expect } from 'vitest'
import {
  createWorld,
  tick,
  seatOf,
  loungeSpot,
  tileCenter,
  stationOf,
} from '../../src/factory/sim.js'
import type { World } from '../../src/factory/sim.js'
import { layoutHall } from '../../src/factory/layout.js'
import { buildRunGraph, withNode } from '../../src/line/run-graph.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { RunGraph } from '../../src/line/run-graph.js'
import type { Observation } from '../../src/factory/events.js'
import { raiseGate } from '../../src/gates/rules.js'

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

  it('settles a passed node in the lounge', () => {
    const g = withNode(graph(), 'a', { state: 'passed' })
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))
    const crew = world.crew.find((c) => c.nodeId === 'a')!
    expect(crew.anim).toBe('couch')
    expect({ x: crew.x, y: crew.y }).toEqual(tileCenter(loungeSpot(map, 'a')!))
  })

  it('a waiting node sits idle in the lounge', () => {
    const g = graph() // 'b' depends on 'a', starts 'waiting'
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))
    expect(world.crew.find((c) => c.nodeId === 'b')?.anim).toBe('idle')
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

  it('two calls on the same graph settle deep-equal worlds', () => {
    const g = withNode(graph(), 'a', { state: 'running' })
    const map = layoutHall(g)
    expect(createWorld(map, obs(g))).toEqual(createWorld(map, obs(g)))
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

  it('a crate exists only after it is added, advances, and is removed on arrival', () => {
    const g = graph()
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))
    expect(world.crates).toEqual([])

    const belt = map.belts[0]
    expect(belt).toBeDefined()
    let w: World = { ...world, crates: [{ id: 'c1', beltId: belt.id, progress: 0 }] }
    w = tick(w, 1000)
    expect(w.crates).toHaveLength(1)
    expect(w.crates[0].progress).toBeGreaterThan(0)

    // enough time that it must have arrived
    for (let i = 0; i < 50; i++) w = tick(w, 1000)
    expect(w.crates).toEqual([])
  })

  it('a crate on an unknown belt id still advances, using a default distance', () => {
    const g = graph()
    const map = layoutHall(g)
    const world = createWorld(map, obs(g))
    let w: World = { ...world, crates: [{ id: 'c1', beltId: 'no-such-belt', progress: 0 }] }
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

describe('loungeSpot', () => {
  it('is deterministic for the same node id', () => {
    const g = graph()
    const map = layoutHall(g)
    expect(loungeSpot(map, 'a')).toEqual(loungeSpot(map, 'a'))
  })

  it('picks among the map lounge tiles', () => {
    const g = graph()
    const map = layoutHall(g)
    const spot = loungeSpot(map, 'a')
    expect(map.anchors.lounge).toContainEqual(spot)
  })
})
