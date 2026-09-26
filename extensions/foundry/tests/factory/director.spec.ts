import { describe, it, expect } from 'vitest'
import { direct } from '../../src/factory/director.js'
import { createWorld, seatOf, tick } from '../../src/factory/sim.js'
import type { World, Crew } from '../../src/factory/sim.js'
import { layoutHall } from '../../src/factory/layout.js'
import { buildRunGraph, withNode } from '../../src/line/run-graph.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { RunGraph } from '../../src/line/run-graph.js'
import type { Observation, FactoryEvent } from '../../src/factory/events.js'

// direct() turns a batch of FactoryEvents into a new World: it never moves
// anyone for a reason that is not one of those events, and coalescing is
// judged from exactly what the batch and `nowMs` say — a call still open long
// enough, or a burst of the same prop close together.

const RECIPE = `
schemaVersion: 1
id: standard
steps:
  - id: foreman
    kind: agent
    role: foreman
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
    after: [b]
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

function worldFor(g: RunGraph): World {
  const map = layoutHall(g)
  return createWorld(map, obs(g))
}

/** A crew member for a node the map has no station for — the staleness case. */
function ghostCrew(nodeId: string, role: string | null = null): Crew {
  return {
    nodeId,
    role,
    x: 0,
    y: 0,
    facing: 'S',
    anim: 'idle',
    path: [],
    goal: null,
    then: 'idle',
    present: true,
  }
}

describe('direct: node-state', () => {
  it('sends a node to its seat, to type, on ready/running', () => {
    const g = graph()
    const world = worldFor(g)
    const events: FactoryEvent[] = [
      { kind: 'node-state', nodeId: 'a', from: 'waiting', to: 'running' },
    ]
    const next = direct(world, events, 0)
    const crew = next.crew.find((c) => c.nodeId === 'a')!
    expect(crew.goal).toEqual(seatOf(world.map, 'a'))
    expect(crew.then).toBe('type')
  })

  it('sends a passed node to the lounge', () => {
    const g = graph()
    const world = worldFor(g)
    const next = direct(
      world,
      [{ kind: 'node-state', nodeId: 'a', from: 'running', to: 'passed' }],
      0
    )
    const crew = next.crew.find((c) => c.nodeId === 'a')!
    expect(crew.then).toBe('couch')
    expect(crew.goal).not.toBe(null)
  })

  it('slumps a failed node at its seat', () => {
    const g = graph()
    const world = worldFor(g)
    const next = direct(
      world,
      [{ kind: 'node-state', nodeId: 'a', from: 'running', to: 'failed' }],
      0
    )
    const crew = next.crew.find((c) => c.nodeId === 'a')!
    expect(crew.then).toBe('slump')
    expect(crew.goal).toEqual(seatOf(world.map, 'a'))
  })

  it('sends a blocked/waiting/skipped node to the lounge, idle', () => {
    const g = graph()
    const world = worldFor(g)
    const next = direct(
      world,
      [{ kind: 'node-state', nodeId: 'a', from: 'ready', to: 'blocked' }],
      0
    )
    expect(next.crew.find((c) => c.nodeId === 'a')!.then).toBe('idle')
  })

  it('has no effect on a node with no crew of its own', () => {
    const g = graph()
    const world = worldFor(g)
    const next = direct(
      world,
      [{ kind: 'node-state', nodeId: 'g', from: 'waiting', to: 'ready' }],
      0
    )
    expect(next).toEqual(world)
  })

  it('sends a run-kind node to its seat scanning, not typing', () => {
    const g = graph()
    const world = worldFor(g)
    const next = direct(
      world,
      [{ kind: 'node-state', nodeId: 'r', from: 'waiting', to: 'running' }],
      0
    )
    const crew = next.crew.find((c) => c.nodeId === 'r')!
    expect(crew.then).toBe('scan')
  })

  it('sends a node to its seat on ready, and on verifying, same as running', () => {
    const g = graph()
    const world = worldFor(g)
    for (const to of ['ready', 'verifying'] as const) {
      const next = direct(world, [{ kind: 'node-state', nodeId: 'a', from: 'waiting', to }], 0)
      expect(next.crew.find((c) => c.nodeId === 'a')!.then).toBe('type')
    }
  })

  it('sends a skipped node to the lounge, distinctly from blocked', () => {
    const g = graph()
    const world = worldFor(g)
    const next = direct(
      world,
      [{ kind: 'node-state', nodeId: 'a', from: 'waiting', to: 'skipped' }],
      0
    )
    expect(next.crew.find((c) => c.nodeId === 'a')!.then).toBe('idle')
  })

  it('leaves a crew member with no station untouched on ready/running/verifying', () => {
    const g = graph()
    const world: World = { ...worldFor(g), crew: [...worldFor(g).crew, ghostCrew('ghost')] }
    const next = direct(
      world,
      [{ kind: 'node-state', nodeId: 'ghost', from: 'waiting', to: 'running' }],
      0
    )
    expect(next.crew.find((c) => c.nodeId === 'ghost')).toEqual(ghostCrew('ghost'))
  })

  it('leaves a crew member with no station untouched on failed', () => {
    const g = graph()
    const world: World = { ...worldFor(g), crew: [...worldFor(g).crew, ghostCrew('ghost')] }
    const next = direct(
      world,
      [{ kind: 'node-state', nodeId: 'ghost', from: 'running', to: 'failed' }],
      0
    )
    expect(next.crew.find((c) => c.nodeId === 'ghost')).toEqual(ghostCrew('ghost'))
  })
})

describe('direct: orphaned / stranded', () => {
  it('marks an orphaned node not present', () => {
    const g = withNode(graph(), 'a', { state: 'running' })
    const world = worldFor(g)
    const next = direct(world, [{ kind: 'orphaned', nodeId: 'a' }], 0)
    const crew = next.crew.find((c) => c.nodeId === 'a')!
    expect(crew.present).toBe(false)
  })

  it('sends a stranded node to wait and wave', () => {
    const g = graph()
    const world = worldFor(g)
    const next = direct(world, [{ kind: 'stranded', nodeId: 'a', on: true }], 0)
    const crew = next.crew.find((c) => c.nodeId === 'a')!
    expect(crew.goal).toEqual(world.map.anchors.wait)
    expect(crew.then).toBe('wave')
  })

  it('sends a node back to its seat once it is no longer stranded', () => {
    const g = graph()
    const world = worldFor(g)
    const next = direct(world, [{ kind: 'stranded', nodeId: 'a', on: false }], 0)
    const crew = next.crew.find((c) => c.nodeId === 'a')!
    expect(crew.goal).toEqual(seatOf(world.map, 'a'))
    expect(crew.then).toBe('idle')
  })

  it('leaves a crew member with no station untouched when its strand clears', () => {
    const g = graph()
    const world: World = { ...worldFor(g), crew: [...worldFor(g).crew, ghostCrew('ghost')] }
    const next = direct(world, [{ kind: 'stranded', nodeId: 'ghost', on: false }], 0)
    expect(next.crew.find((c) => c.nodeId === 'ghost')).toEqual(ghostCrew('ghost'))
  })
})

// In production `direct` is called on every ~2s poll with only the *new*
// events since the last one: a long Read emits `tool_started` exactly once,
// when it starts. So a call already open at the time it is first seen does
// not yet justify a walk (it might close in the next instant); what makes it
// worth walking for is the call still being open, unclosed, on a *later*
// poll that carries no new event for it at all. `World.openCalls` is what
// lets `direct` judge that with nothing but `nowMs` to go on.
describe('direct: tool coalescing', () => {
  it('does not walk the instant a call opens', () => {
    const g = graph()
    const world = worldFor(g)
    const events: FactoryEvent[] = [
      { kind: 'tool', nodeId: 'a', prop: 'archive', callId: 'c1', open: true, at: 0 },
    ]
    const next = direct(world, events, 0)
    const crew = next.crew.find((c) => c.nodeId === 'a')!
    expect(crew.goal).toBe(null)
    expect(next.openCalls).toEqual([{ nodeId: 'a', prop: 'archive', callId: 'c1', at: 0 }])
  })

  it('reproduces the reported defect: a call open ≥1500ms is walked to on a later poll with no new events', () => {
    const g = graph()
    let world = worldFor(g)
    // Poll 1: the call starts.
    world = direct(
      world,
      [{ kind: 'tool', nodeId: 'a', prop: 'archive', callId: 'c1', open: true, at: 0 }],
      0
    )
    expect(world.crew.find((c) => c.nodeId === 'a')!.goal).toBe(null)

    // Poll 2, 2s later: no new events at all — the call is still running.
    world = direct(world, [], 2000)
    const crew = world.crew.find((c) => c.nodeId === 'a')!
    expect(crew.goal).toEqual(world.map.anchors.archive)
    expect(crew.then).toBe('reach')

    // The builder actually leaves its seat once ticked.
    const seat = seatOf(world.map, 'a')!
    let ticked = world
    for (let elapsed = 0; elapsed < 3000; elapsed += 100) ticked = tick(ticked, 100)
    const afterCrew = ticked.crew.find((c) => c.nodeId === 'a')!
    expect(afterCrew.x === seat.x && afterCrew.y === seat.y).toBe(false)
  })

  it('a call that closes at 1000ms never causes a walk', () => {
    const g = graph()
    let world = worldFor(g)
    world = direct(
      world,
      [{ kind: 'tool', nodeId: 'a', prop: 'archive', callId: 'c1', open: true, at: 0 }],
      0
    )
    world = direct(
      world,
      [{ kind: 'tool', nodeId: 'a', prop: 'archive', callId: 'c1', open: false, at: 1000 }],
      1000
    )
    const crew = world.crew.find((c) => c.nodeId === 'a')!
    expect(crew.goal).toEqual(seatOf(world.map, 'a'))
    expect(crew.then).toBe('idle')
    expect(world.openCalls).toEqual([])

    // and it stays put with nothing left open, however much later we check
    const later = direct(world, [], 100_000)
    expect(later.crew.find((c) => c.nodeId === 'a')!.goal).toEqual(seatOf(world.map, 'a'))
  })

  it('walks to the rack on a burst of 3 same-prop calls, all still open, in one poll', () => {
    const g = graph()
    const world = worldFor(g)
    const events: FactoryEvent[] = [
      { kind: 'tool', nodeId: 'a', prop: 'rack', callId: 'c1', open: true, at: 100 },
      { kind: 'tool', nodeId: 'a', prop: 'rack', callId: 'c2', open: true, at: 1000 },
      { kind: 'tool', nodeId: 'a', prop: 'rack', callId: 'c3', open: true, at: 2000 },
    ]
    const next = direct(world, events, 2100)
    const crew = next.crew.find((c) => c.nodeId === 'a')!
    expect(crew.goal).toEqual(world.map.anchors.rack)
  })

  it('does not walk for 2 quick, still-open calls', () => {
    const g = graph()
    const world = worldFor(g)
    const events: FactoryEvent[] = [
      { kind: 'tool', nodeId: 'a', prop: 'rack', callId: 'c1', open: true, at: 100 },
      { kind: 'tool', nodeId: 'a', prop: 'rack', callId: 'c2', open: true, at: 200 },
    ]
    const next = direct(world, events, 300)
    expect(next.crew.find((c) => c.nodeId === 'a')!.goal).toBe(null)
  })

  it('a desk-prop tool call never moves anyone, and is never remembered', () => {
    const g = graph()
    const world = worldFor(g)
    const events: FactoryEvent[] = [
      { kind: 'tool', nodeId: 'a', prop: 'desk', callId: 'c1', open: true, at: 0 },
    ]
    const next = direct(world, events, 100_000)
    expect(next).toEqual(world)
  })

  it('returns to the seat on close when no other call of that prop is open', () => {
    const g = graph()
    const world = worldFor(g)
    const events: FactoryEvent[] = [
      { kind: 'tool', nodeId: 'a', prop: 'archive', callId: 'c1', open: false, at: 100 },
    ]
    const next = direct(world, events, 100)
    const crew = next.crew.find((c) => c.nodeId === 'a')!
    expect(crew.goal).toEqual(seatOf(world.map, 'a'))
    expect(crew.then).toBe('idle')
  })

  it('stays put on close while another call of that prop is still open', () => {
    const g = graph()
    let world = worldFor(g)
    world = direct(
      world,
      [{ kind: 'tool', nodeId: 'a', prop: 'archive', callId: 'c2', open: true, at: 100 }],
      100
    )
    const next = direct(
      world,
      [{ kind: 'tool', nodeId: 'a', prop: 'archive', callId: 'c1', open: false, at: 200 }],
      200
    )
    const crew = next.crew.find((c) => c.nodeId === 'a')!
    // c1 closing does not send anyone home: c2 is still open.
    expect(crew.goal).not.toEqual(seatOf(world.map, 'a'))
    expect(next.openCalls).toEqual([{ nodeId: 'a', prop: 'archive', callId: 'c2', at: 100 }])
  })

  it('does not re-remember a call it has already seen open', () => {
    const g = graph()
    let world = worldFor(g)
    const event: FactoryEvent = {
      kind: 'tool',
      nodeId: 'a',
      prop: 'archive',
      callId: 'c1',
      open: true,
      at: 0,
    }
    world = direct(world, [event], 0)
    world = direct(world, [event], 0)
    expect(world.openCalls).toEqual([{ nodeId: 'a', prop: 'archive', callId: 'c1', at: 0 }])
  })

  it('leaves a crew member with no station untouched when its call closes', () => {
    const g = graph()
    const world: World = { ...worldFor(g), crew: [...worldFor(g).crew, ghostCrew('ghost')] }
    const events: FactoryEvent[] = [
      { kind: 'tool', nodeId: 'ghost', prop: 'archive', callId: 'c1', open: false, at: 0 },
    ]
    const next = direct(world, events, 0)
    expect(next.crew.find((c) => c.nodeId === 'ghost')).toEqual(ghostCrew('ghost'))
  })
})

describe('direct: handoff', () => {
  it('adds a crate on the matching belt, at progress 0', () => {
    const g = graph()
    const world = worldFor(g)
    expect(world.crates).toEqual([])
    const next = direct(
      world,
      [{ kind: 'handoff', fromNodeId: 'a', toNodeId: 'b', targetStarted: false }],
      0
    )
    expect(next.crates).toHaveLength(1)
    expect(next.crates[0].progress).toBe(0)
    expect(next.crates[0].beltId).toBe('a->b')
    expect(next.crates[0].parks).toBe(true)
  })

  it('a crate for a step already running is consumed on arrival, not parked', () => {
    const world = worldFor(graph())
    const next = direct(
      world,
      [{ kind: 'handoff', fromNodeId: 'a', toNodeId: 'b', targetStarted: true }],
      0
    )
    expect(next.crates[0].parks).toBe(false)
  })

  it('a step starting takes in the work parked at it', () => {
    const world = {
      ...worldFor(graph()),
      crates: [{ id: 'q', beltId: 'a->b', progress: 1, parks: true }],
    }
    const next = direct(
      world,
      [{ kind: 'node-state', nodeId: 'b', from: 'ready', to: 'running' }],
      0
    )
    expect(next.crates).toEqual([{ id: 'q', beltId: 'a->b', progress: 1, parks: false }])
  })

  it('does nothing for a handoff with no matching belt', () => {
    const g = graph()
    const world = worldFor(g)
    const next = direct(
      world,
      [{ kind: 'handoff', fromNodeId: 'ghost', toNodeId: 'nowhere', targetStarted: false }],
      0
    )
    expect(next.crates).toEqual([])
  })
})

describe('direct: rework', () => {
  it('adds a parked crate on the belt between the check and the node it sent back', () => {
    const g = graph()
    const world = worldFor(g)
    expect(world.crates).toEqual([])
    const next = direct(world, [{ kind: 'rework', fromNodeId: 'b', toNodeId: 'a', round: 1 }], 0)
    expect(next.crates).toHaveLength(1)
    expect(next.crates[0].beltId).toBe('a->b')
    expect(next.crates[0].progress).toBe(0)
    expect(next.crates[0].parks).toBe(true)
  })

  it('does nothing for a rework with no matching belt', () => {
    const g = graph()
    const world = worldFor(g)
    const next = direct(
      world,
      [{ kind: 'rework', fromNodeId: 'ghost', toNodeId: 'nowhere', round: 1 }],
      0
    )
    expect(next.crates).toEqual([])
  })
})

describe('direct: gate', () => {
  it('adds the node to gatesWaiting and sends the foreman to wave at its seat', () => {
    const g = graph()
    const world = worldFor(g)
    const next = direct(world, [{ kind: 'gate', nodeId: 'g', waiting: true }], 0)
    expect(next.gatesWaiting).toEqual(['g'])
    const foreman = next.crew.find((c) => c.role === 'foreman')!
    expect(foreman.then).toBe('wave')
    expect(foreman.goal).toEqual(seatOf(world.map, 'g'))
  })

  it('does not duplicate an already-waiting gate', () => {
    const g = graph()
    const world: World = { ...worldFor(g), gatesWaiting: ['g'] }
    const next = direct(world, [{ kind: 'gate', nodeId: 'g', waiting: true }], 0)
    expect(next.gatesWaiting).toEqual(['g'])
  })

  it('removes the node from gatesWaiting and sends the foreman back on clear', () => {
    const g = graph()
    const world: World = { ...worldFor(g), gatesWaiting: ['g'] }
    const next = direct(world, [{ kind: 'gate', nodeId: 'g', waiting: false }], 0)
    expect(next.gatesWaiting).toEqual([])
    const foreman = next.crew.find((c) => c.role === 'foreman')!
    expect(foreman.then).toBe('idle')
  })

  it('adds gatesWaiting without moving the foreman when the gate node has no station', () => {
    const g = graph()
    const world = worldFor(g)
    const next = direct(world, [{ kind: 'gate', nodeId: 'ghost', waiting: true }], 0)
    expect(next.gatesWaiting).toEqual(['ghost'])
    const foreman = next.crew.find((c) => c.role === 'foreman')!
    expect(foreman.goal).toBe(null)
  })

  it('clears gatesWaiting without moving a foreman that has no station', () => {
    const g = graph()
    const base = worldFor(g)
    const world: World = {
      ...base,
      gatesWaiting: ['g'],
      crew: [...base.crew.filter((c) => c.role !== 'foreman'), ghostCrew('foreman-x', 'foreman')],
    }
    const next = direct(world, [{ kind: 'gate', nodeId: 'g', waiting: false }], 0)
    expect(next.gatesWaiting).toEqual([])
    expect(next.crew.find((c) => c.role === 'foreman')).toEqual(ghostCrew('foreman-x', 'foreman'))
  })

  it('does nothing at all when there is no foreman crew', () => {
    const g = graph()
    const base = worldFor(g)
    const world: World = { ...base, crew: base.crew.filter((c) => c.role !== 'foreman') }
    const next = direct(world, [{ kind: 'gate', nodeId: 'g', waiting: true }], 0)
    expect(next.gatesWaiting).toEqual(['g'])
    expect(next.crew).toEqual(world.crew)
  })
})

describe('direct: applies a batch of events in order and is pure', () => {
  it('does not mutate the world it was given', () => {
    const g = graph()
    const world = worldFor(g)
    const before = JSON.parse(JSON.stringify(world))
    direct(world, [{ kind: 'node-state', nodeId: 'a', from: 'waiting', to: 'running' }], 0)
    expect(world).toEqual(before)
  })

  it('applies several events in one call', () => {
    const g = graph()
    const world = worldFor(g)
    const events: FactoryEvent[] = [
      { kind: 'node-state', nodeId: 'a', from: 'waiting', to: 'running' },
      { kind: 'handoff', fromNodeId: 'a', toNodeId: 'b', targetStarted: false },
    ]
    const next = direct(world, events, 0)
    expect(next.crew.find((c) => c.nodeId === 'a')!.then).toBe('type')
    expect(next.crates).toHaveLength(1)
  })
})
