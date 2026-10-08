import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { direct } from '../../src/factory/director.js'
import { createWorld, seatOf, tick, VERDICT_MS } from '../../src/factory/sim.js'
import type { World, Crew } from '../../src/factory/sim.js'
import { layoutHall } from '../../src/factory/layout.js'
import { buildRunGraph, withNode } from '../../src/line/run-graph.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { RunGraph } from '../../src/line/run-graph.js'
import { diffObservation } from '../../src/factory/events.js'
import type { Observation, FactoryEvent } from '../../src/factory/events.js'
import { readTranscript } from '../../src/runtime/transcript-tailer.js'

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

function worldFor(g: RunGraph): World {
  const map = layoutHall(g)
  return createWorld(map, obs(g))
}

/** The graph with `a` (a builder at a desk) and `r` (a run step at a rig) mid-step. */
function runningGraph(): RunGraph {
  return withNode(withNode(graph(), 'a', { state: 'running' }), 'r', { state: 'running' })
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
    restSeat: null,
    settle: null,
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

  it('sends a passed node to a breakroom rest seat', () => {
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
    expect(crew.restSeat).not.toBe(null)
    expect(crew.settle).not.toBe(null)
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

  it('sends a blocked/waiting/skipped node to a rest seat, to sit', () => {
    const g = graph()
    const world = worldFor(g)
    const next = direct(
      world,
      [{ kind: 'node-state', nodeId: 'a', from: 'ready', to: 'blocked' }],
      0
    )
    const crew = next.crew.find((c) => c.nodeId === 'a')!
    expect(crew.then).toBe('couch')
    expect(crew.restSeat).not.toBe(null)
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

  it('sends a skipped node to a rest seat too', () => {
    const g = graph()
    const world = worldFor(g)
    const next = direct(
      world,
      [{ kind: 'node-state', nodeId: 'a', from: 'waiting', to: 'skipped' }],
      0
    )
    const crew = next.crew.find((c) => c.nodeId === 'a')!
    expect(crew.then).toBe('couch')
    expect(crew.restSeat).not.toBe(null)
  })

  it('has no effect on an idle transition for a node with no crew of its own', () => {
    const g = graph()
    const world = worldFor(g)
    const next = direct(
      world,
      [{ kind: 'node-state', nodeId: 'g', from: 'waiting', to: 'skipped' }],
      0
    )
    expect(next).toEqual(world)
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

  it('sends a node back to its seat, working, once it is no longer stranded', () => {
    const world = worldFor(runningGraph())
    const off: FactoryEvent = { kind: 'stranded', nodeId: 'a', on: false }
    const crew = direct(world, [off], 0).crew.find((c) => c.nodeId === 'a')!
    expect(crew.goal).toEqual(seatOf(world.map, 'a'))
    expect(crew.then).toBe('type')
    const rig = direct(world, [{ ...off, nodeId: 'r' }], 0).crew.find((c) => c.nodeId === 'r')!
    expect(rig.then).toBe('scan')
  })

  it('leaves a resting crew member resting when a strand clears late', () => {
    const world = worldFor(graph())
    const before = world.crew.find((c) => c.nodeId === 'a')!
    expect(before.restSeat).not.toBeNull()
    const next = direct(world, [{ kind: 'stranded', nodeId: 'a', on: false }], 0)
    expect(next.crew.find((c) => c.nodeId === 'a')).toEqual(before)
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
    const g = runningGraph()
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
    expect(crew.then).toBe('type')
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

  it('a desk-prop tool call is remembered but never moves anyone, and its close retires it', () => {
    const world = worldFor(runningGraph())
    const open: FactoryEvent = {
      kind: 'tool',
      nodeId: 'a',
      prop: 'desk',
      callId: 'c1',
      open: true,
      at: 0,
    }
    const opened = direct(world, [open, open], 100_000)
    expect(opened.openCalls).toEqual([{ nodeId: 'a', prop: 'desk', callId: 'c1', at: 0 }])
    expect(opened.crew).toEqual(world.crew)

    const closed = direct(opened, [{ ...open, open: false }], 100_001)
    expect(closed.openCalls).toEqual([])
  })

  it('returns to the seat, working, on close when no other call is open', () => {
    const world = worldFor(runningGraph())
    const close = (nodeId: string): FactoryEvent => ({
      kind: 'tool',
      nodeId,
      prop: 'archive',
      callId: 'c1',
      open: false,
      at: 100,
    })
    const builder = direct(world, [close('a')], 100).crew.find((c) => c.nodeId === 'a')!
    expect(builder.goal).toEqual(seatOf(world.map, 'a'))
    expect(builder.then).toBe('type')
    const rig = direct(world, [close('r')], 100).crew.find((c) => c.nodeId === 'r')!
    expect(rig.goal).toEqual(seatOf(world.map, 'r'))
    expect(rig.then).toBe('scan')
  })

  it('leaves a resting crew member resting when a call closes late', () => {
    const world = worldFor(graph())
    const before = world.crew.find((c) => c.nodeId === 'a')!
    expect(before.then).toBe('couch')
    const next = direct(
      world,
      [{ kind: 'tool', nodeId: 'a', prop: 'archive', callId: 'c1', open: false, at: 100 }],
      100
    )
    expect(next.crew.find((c) => c.nodeId === 'a')).toEqual(before)
  })

  it('leaves a slumped crew member slumped when a call closes late', () => {
    const world = worldFor(withNode(graph(), 'a', { state: 'failed' }))
    const before = world.crew.find((c) => c.nodeId === 'a')!
    expect(before.then).toBe('slump')
    const next = direct(
      world,
      [{ kind: 'tool', nodeId: 'a', prop: 'archive', callId: 'c1', open: false, at: 100 }],
      100
    )
    expect(next.crew.find((c) => c.nodeId === 'a')).toEqual(before)
  })

  it('a stale dropped call returns its crew member to work', () => {
    let world = worldFor(runningGraph())
    world = direct(
      world,
      [{ kind: 'tool', nodeId: 'a', prop: 'archive', callId: 'c1', open: true, at: 0 }],
      0
    )
    const next = direct(world, [], 4 * 60_000)
    expect(next.openCalls).toEqual([])
    const crew = next.crew.find((c) => c.nodeId === 'a')!
    expect(crew.goal).toEqual(seatOf(world.map, 'a'))
    expect(crew.then).toBe('type')
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

describe('direct: verdicts', () => {
  const finish = (
    to: 'passed' | 'failed',
    from: 'running' | 'passed' = 'running'
  ): FactoryEvent => ({
    kind: 'node-state',
    nodeId: 'a',
    from,
    to,
  })

  it('records a pass at the world clock when a step passes', () => {
    const world = { ...worldFor(runningGraph()), clockMs: 4200 }
    expect(direct(world, [finish('passed')], 0).verdicts).toEqual([
      { nodeId: 'a', pass: true, at: 4200 },
    ])
  })

  it('records a fail at the world clock when a step fails', () => {
    const world = { ...worldFor(runningGraph()), clockMs: 900 }
    expect(direct(world, [finish('failed')], 0).verdicts).toEqual([
      { nodeId: 'a', pass: false, at: 900 },
    ])
  })

  it('replaces an earlier verdict for the same node', () => {
    const world = { ...worldFor(runningGraph()), clockMs: 100 }
    const failed = direct(world, [finish('failed')], 0)
    const passed = direct({ ...failed, clockMs: 500 }, [finish('passed')], 0)
    expect(passed.verdicts).toEqual([{ nodeId: 'a', pass: true, at: 500 }])
  })

  it('records nothing for a same-state event', () => {
    const world = worldFor(runningGraph())
    expect(direct(world, [finish('passed', 'passed')], 0).verdicts).toEqual([])
  })

  it('records nothing for a step that merely starts', () => {
    const world = worldFor(graph())
    const start: FactoryEvent = { kind: 'node-state', nodeId: 'a', from: 'waiting', to: 'running' }
    expect(direct(world, [start], 0).verdicts).toEqual([])
  })

  it('expires at VERDICT_MS and not before', () => {
    const world = direct(worldFor(runningGraph()), [finish('passed')], 0)
    expect(tick(world, VERDICT_MS - 1).verdicts).toHaveLength(1)
    expect(tick(world, VERDICT_MS).verdicts).toEqual([])
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
  const realGraph = (): RunGraph =>
    JSON.parse(
      readFileSync(join(__dirname, 'fixtures', 'run-graph-real.json'), 'utf-8')
    ) as RunGraph
  const realWorld = (): World => worldFor(realGraph())
  const crewOf = (world: World, id: string): Crew => world.crew.find((c) => c.nodeId === id)!
  const adjacent = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1

  it('has the check carry the box to the node it sent back, with no crate on a belt', () => {
    const world = realWorld()
    const next = direct(
      world,
      [{ kind: 'rework', fromNodeId: 'verify', toNodeId: 'build:lane-1', round: 1 }],
      0
    )
    const verifier = crewOf(next, 'verify')
    expect(verifier.carrying).toBe(true)
    expect(adjacent(verifier.goal!, seatOf(world.map, 'build:lane-1')!)).toBe(true)
    expect(next.map.walk[verifier.goal!.y][verifier.goal!.x]).toBe(false)
    expect(next.crates).toEqual(world.crates)
  })

  it('has the target walk to a check with no crew and bring the box back', () => {
    const world = realWorld()
    const next = direct(
      world,
      [{ kind: 'rework', fromNodeId: 'ship', toNodeId: 'inspect', round: 1 }],
      0
    )
    const inspector = crewOf(next, 'inspect')
    expect(inspector.carrying).toBeFalsy()
    expect(adjacent(inspector.goal!, seatOf(world.map, 'ship')!)).toBe(true)
    expect(inspector.errand!.map((s) => s.act)).toEqual(['pickup', 'drop', 'home'])
    expect(next.crates).toEqual(world.crates)
  })

  it('draws nothing when neither side has crew', () => {
    const g = graph()
    const world = worldFor(g)
    const next = direct(
      world,
      [{ kind: 'rework', fromNodeId: 'ghost', toNodeId: 'nowhere', round: 1 }],
      0
    )
    expect(next).toEqual(world)
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

describe('direct: CI', () => {
  it('records the round on a ci-round event', () => {
    const g = graph()
    const world = worldFor(g)
    const next = direct(world, [{ kind: 'ci-round', round: 2, max: 3 }], 0)
    expect(next.ci).toEqual({ round: 2, max: 3, checks: {} })
  })

  it('records a check bucket on a ci-check event, keeping earlier checks', () => {
    const g = graph()
    const world = worldFor(g)
    const round = direct(world, [{ kind: 'ci-round', round: 1, max: 3 }], 0)
    const one = direct(round, [{ kind: 'ci-check', name: 'test', bucket: 'fail' }], 0)
    const two = direct(one, [{ kind: 'ci-check', name: 'lint', bucket: 'pass' }], 0)
    expect(two.ci).toEqual({ round: 1, max: 3, checks: { test: 'fail', lint: 'pass' } })
  })

  it('overwrites a check bucket when it changes', () => {
    const g = graph()
    const world = worldFor(g)
    const one = direct(world, [{ kind: 'ci-check', name: 'test', bucket: 'pending' }], 0)
    const two = direct(one, [{ kind: 'ci-check', name: 'test', bucket: 'pass' }], 0)
    expect(two.ci?.checks.test).toBe('pass')
  })
})

// The real bug: a worker walked to the bookshelf or the server rack and never
// walked back. It was never in `direct`'s own unit tests — those fed it
// close events shaped the way production ought to produce them, which is not
// how `readTranscript` actually shaped them (an empty `toolName`, always
// `toolProp('', false) === 'desk'`, which `applyTool`'s old prop-matched
// lookup could never pair with the matching open). These drive the real
// tailer -> diffObservation -> direct pipeline end to end, on both an
// archive tool (Read) and a rack tool (Bash), and fail on the old code.
describe('direct: the real pipeline never strands a worker at the shelf or the rack', () => {
  let dir: string
  let transcript: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'director-pipeline-'))
    transcript = join(dir, 's1.jsonl')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function toolUseLine(id: string, name: string, at: string): string {
    return JSON.stringify({
      type: 'assistant',
      timestamp: at,
      message: { content: [{ type: 'tool_use', id, name }] },
    })
  }

  function toolResultLine(id: string, at: string): string {
    return JSON.stringify({
      type: 'user',
      timestamp: at,
      message: { content: [{ type: 'tool_result', tool_use_id: id }] },
    })
  }

  /** Runs one call from open through close over the real pipeline, and returns the crew member. */
  function runCall(toolName: string): Crew {
    writeFileSync(transcript, toolUseLine('c1', toolName, '2026-09-27T10:00:00.000Z') + '\n')

    const g = runningGraph()
    const map = layoutHall(g)
    const emptyObs = obs(g, { activity: {} })
    let world = createWorld(map, emptyObs)

    const started = readTranscript(transcript)
    const afterStart = obs(g, { activity: { a: started } })
    world = direct(world, diffObservation(emptyObs, afterStart), 0)

    appendFileSync(transcript, toolResultLine('c1', '2026-09-27T10:00:05.000Z') + '\n')
    const finished = readTranscript(transcript)
    const afterFinish = obs(g, { activity: { a: finished } })
    world = direct(world, diffObservation(afterStart, afterFinish), 5000)

    return world.crew.find((c) => c.nodeId === 'a')!
  }

  it('walks a Read call to the bookshelf and back to the seat when it closes', () => {
    const crew = runCall('Read')
    const seat = seatOf(layoutHall(graph()), 'a')
    expect(seat).not.toBeNull()
    expect(crew.goal).toEqual(seat)
    expect(crew.then).toBe('type')
  })

  it('walks a Bash call to the rack and back to the seat when it closes', () => {
    const crew = runCall('Bash')
    expect(crew.goal).toEqual(seatOf(layoutHall(graph()), 'a'))
    expect(crew.then).toBe('type')
  })

  it('the world after the close no longer remembers the call as open', () => {
    writeFileSync(transcript, toolUseLine('c1', 'Read', '2026-09-27T10:00:00.000Z') + '\n')
    const g = graph()
    const map = layoutHall(g)
    const emptyObs = obs(g, { activity: {} })
    let world = createWorld(map, emptyObs)

    const started = readTranscript(transcript)
    const afterStart = obs(g, { activity: { a: started } })
    world = direct(world, diffObservation(emptyObs, afterStart), 0)
    expect(world.openCalls).toHaveLength(1)

    appendFileSync(transcript, toolResultLine('c1', '2026-09-27T10:00:05.000Z') + '\n')
    const finished = readTranscript(transcript)
    const afterFinish = obs(g, { activity: { a: finished } })
    world = direct(world, diffObservation(afterStart, afterFinish), 5000)
    expect(world.openCalls).toEqual([])
  })
})

describe('direct: queue', () => {
  it('records the position and who it is behind on a queued event', () => {
    const g = graph()
    const world = worldFor(g)
    const next = direct(world, [{ kind: 'queued', position: 2, behind: ['Other order'] }], 0)
    expect(next.queue).toEqual({ position: 2, behind: ['Other order'] })
  })

  it('overwrites the position when it moves', () => {
    const g = graph()
    const world = worldFor(g)
    const first = direct(world, [{ kind: 'queued', position: 2, behind: ['Other order'] }], 0)
    const second = direct(first, [{ kind: 'queued', position: 1, behind: ['Other order'] }], 0)
    expect(second.queue).toEqual({ position: 1, behind: ['Other order'] })
  })
})
