import { describe, it, expect } from 'vitest'
import {
  drawProp,
  bakeHall,
  drawBelts,
  drawCrate,
  drawQueuePlate,
} from '../../../src/factory/art/props.js'
import type { SceneContext } from '../../../src/factory/art/props.js'
import { HALL } from '../../../src/factory/art/palette.js'
import { TILE_PX } from '../../../src/factory/layout.js'
import type {
  HallProp,
  HallMap,
  HallBelt,
  BeltTile,
  PropKind,
  Tile,
} from '../../../src/factory/layout.js'
import type { Crew } from '../../../src/factory/sim.js'
import { createRecordingPaint } from './paint-fake.js'
import type { PaintCall } from './paint-fake.js'

// The honesty rule under test: a prop's "alive" details (lit screens, a
// waveform, a flashing beacon, moving treads) exist in the recorded draw
// calls only when the cause the design names for them is present, and never
// otherwise — regardless of the clock. Breakroom furniture (bench, sofa,
// table, fridge, coffeebar, vending, partition) never reads `SceneContext`
// at all: it draws the same regardless of crew or clock.

const ALL_PROP_KINDS: readonly PropKind[] = [
  'desk',
  'rig',
  'bench',
  'press',
  'gate',
  'shelves',
  'racks',
  'statuswall',
  'lockers',
  'plant',
  'chair',
  'partition',
  'restbench',
  'sofa',
  'table',
  'lowtable',
  'fridge',
  'coffeebar',
  'vending',
  'dispatch',
]

const PROP_DEFAULTS: Readonly<Partial<Record<PropKind, Partial<HallProp>>>> = {
  desk: { w: 3, h: 1 },
  press: { w: 3, h: 2 },
  gate: { w: 1, h: 1 },
  rig: { w: 2, h: 1 },
  bench: { w: 2, h: 1 },
  chair: { w: 1, h: 1 },
  partition: { w: 4, h: 2, x: 7, y: 19 },
  sofa: { w: 2, h: 1 },
  table: { w: 2, h: 1 },
  lowtable: { w: 2, h: 1 },
  fridge: { w: 1, h: 1 },
  coffeebar: { w: 1, h: 1 },
  vending: { w: 1, h: 1 },
}

const DECOR_KINDS = new Set<PropKind>([
  'chair',
  'shelves',
  'partition',
  'restbench',
  'sofa',
  'table',
  'lowtable',
  'fridge',
  'coffeebar',
  'vending',
])

function crew(overrides: Partial<Crew>): Crew {
  return {
    nodeId: 'n1',
    role: 'builder',
    x: 0,
    y: 0,
    facing: 'S',
    anim: 'idle',
    path: [],
    goal: null,
    then: 'idle',
    present: true,
    ...overrides,
  }
}

function prop(kind: PropKind, overrides: Partial<HallProp> = {}): HallProp {
  return {
    id: kind === 'chair' ? 'chair-n1' : `station-n1`,
    kind,
    x: 4,
    y: 4,
    w: 2,
    h: 1,
    solid: true,
    nodeId: DECOR_KINDS.has(kind) ? null : 'n1',
    seat: { x: 4, y: 5 },
    ...PROP_DEFAULTS[kind],
    ...overrides,
  }
}

function context(overrides: Partial<SceneContext> = {}): SceneContext {
  return { crew: [], states: {}, gatesWaiting: [], ...overrides }
}

function containsColor(calls: readonly PaintCall[], color: string): boolean {
  return calls.some((c) => c.op === 'fillRect' && (c as { style?: unknown }).style === color)
}

function hasRect(
  calls: readonly PaintCall[],
  x: number,
  y: number,
  w: number,
  h: number,
  style: string
): boolean {
  return calls.some(
    (c) =>
      c.op === 'fillRect' && c.x === x && c.y === y && c.w === w && c.h === h && c.style === style
  )
}

describe('factory/art/props drawProp', () => {
  it('draws every PropKind without throwing', () => {
    for (const kind of ALL_PROP_KINDS) {
      const paint = createRecordingPaint()
      expect(() => drawProp(paint, prop(kind), context(), 1234)).not.toThrow()
      expect(paint.calls.length).toBeGreaterThan(0)
    }
  })

  it('lights a desk only when a present crew member of its own node is typing', () => {
    const lit = createRecordingPaint()
    drawProp(lit, prop('desk'), context({ crew: [crew({ nodeId: 'n1', anim: 'type' })] }), 0)
    expect(containsColor(lit.calls, HALL.screenOn)).toBe(true)

    const idle = createRecordingPaint()
    drawProp(idle, prop('desk'), context({ crew: [crew({ nodeId: 'n1', anim: 'idle' })] }), 0)
    expect(containsColor(idle.calls, HALL.screenOn)).toBe(false)

    const orphaned = createRecordingPaint()
    drawProp(
      orphaned,
      prop('desk'),
      context({ crew: [crew({ nodeId: 'n1', anim: 'type', present: false })] }),
      0
    )
    expect(containsColor(orphaned.calls, HALL.screenOn)).toBe(false)

    const otherNode = createRecordingPaint()
    drawProp(otherNode, prop('desk'), context({ crew: [crew({ nodeId: 'n2', anim: 'type' })] }), 0)
    expect(containsColor(otherNode.calls, HALL.screenOn)).toBe(false)
  })

  it('draws a rig waveform only while its crew scans', () => {
    const scanning = createRecordingPaint()
    drawProp(scanning, prop('rig'), context({ crew: [crew({ nodeId: 'n1', anim: 'scan' })] }), 0)
    expect(containsColor(scanning.calls, HALL.green)).toBe(true)

    const idle = createRecordingPaint()
    drawProp(idle, prop('rig'), context({ crew: [crew({ nodeId: 'n1', anim: 'idle' })] }), 0)
    expect(containsColor(idle.calls, HALL.green)).toBe(false)
  })

  it('sweeps a bench cursor only while its crew scans', () => {
    const scanning = createRecordingPaint()
    drawProp(
      scanning,
      prop('bench'),
      context({ crew: [crew({ nodeId: 'n1', anim: 'scan' })] }),
      300
    )
    expect(containsColor(scanning.calls, HALL.cyan)).toBe(true)

    const idle = createRecordingPaint()
    drawProp(idle, prop('bench'), context({ crew: [crew({ nodeId: 'n1', anim: 'idle' })] }), 300)
    expect(containsColor(idle.calls, HALL.cyan)).toBe(false)
  })
  it('draws a rest bench identically regardless of crew or clock — it is breakroom furniture, not a station', () => {
    const scanning = createRecordingPaint()
    drawProp(
      scanning,
      prop('restbench'),
      context({ crew: [crew({ nodeId: 'n1', anim: 'scan' })] }),
      0
    )

    const idleLater = createRecordingPaint()
    drawProp(idleLater, prop('restbench'), context(), 900)

    expect(scanning.calls).toEqual(idleLater.calls)
    expect(scanning.calls.length).toBeGreaterThan(0)
  })

  it('draws the gate arm open when its node has passed', () => {
    const open = createRecordingPaint()
    drawProp(open, prop('gate'), context({ states: { n1: 'passed' } }), 0)
    expect(open.calls.length).toBeGreaterThan(0)
  })

  it('lights the passed lamp only when that node state is passed', () => {
    const passed = createRecordingPaint()
    drawProp(passed, prop('desk'), context({ states: { n1: 'passed' } }), 0)
    expect(containsColor(passed.calls, HALL.green)).toBe(true)

    const running = createRecordingPaint()
    drawProp(running, prop('desk'), context({ states: { n1: 'running' } }), 0)
    expect(containsColor(running.calls, HALL.green)).toBe(false)
  })

  it('flashes the gate beacon only while its node is in gatesWaiting', () => {
    const t0 = createRecordingPaint()
    drawProp(t0, prop('gate'), context({ gatesWaiting: ['n1'] }), 0)
    const t1 = createRecordingPaint()
    drawProp(t1, prop('gate'), context({ gatesWaiting: ['n1'] }), 250)
    expect(t0.calls).not.toEqual(t1.calls)

    const idleT0 = createRecordingPaint()
    drawProp(idleT0, prop('gate'), context(), 0)
    const idleT1 = createRecordingPaint()
    drawProp(idleT1, prop('gate'), context(), 250)
    expect(idleT0.calls).toEqual(idleT1.calls)
  })

  it('hides the chair silhouette only while its owner is typing', () => {
    const seated = createRecordingPaint()
    drawProp(seated, prop('chair'), context({ crew: [crew({ nodeId: 'n1', anim: 'type' })] }), 0)
    expect(containsColor(seated.calls, '#3a4150')).toBe(false)

    const empty = createRecordingPaint()
    drawProp(empty, prop('chair'), context(), 0)
    expect(containsColor(empty.calls, '#3a4150')).toBe(true)
  })

  it('lights the dispatch tower with one lamp per check, coloured by bucket', () => {
    const paint = createRecordingPaint()
    drawProp(
      paint,
      prop('dispatch'),
      context({ ci: { checks: { test: 'fail', lint: 'pass', typecheck: 'pending' } } }),
      0
    )
    expect(containsColor(paint.calls, HALL.red)).toBe(true)
    expect(containsColor(paint.calls, HALL.green)).toBe(true)
    expect(containsColor(paint.calls, HALL.amber)).toBe(true)
  })

  it('draws no lamps for a dispatch tower nothing has reported checks for', () => {
    const paint = createRecordingPaint()
    drawProp(paint, prop('dispatch'), context({ ci: { checks: {} } }), 0)
    expect(containsColor(paint.calls, HALL.red)).toBe(false)
    expect(containsColor(paint.calls, HALL.green)).toBe(false)
  })

  it('draws the status wall the order metrics own numbers', () => {
    const paint = createRecordingPaint()
    drawProp(
      paint,
      prop('statuswall', { w: 6 }),
      context({ metrics: { leadTimeMs: 80 * 60_000, reworks: 2, ciRounds: 3 } }),
      0
    )
    expect(containsColor(paint.calls, HALL.cyan)).toBe(true)
    expect(containsColor(paint.calls, HALL.red)).toBe(true)
    expect(containsColor(paint.calls, HALL.amber)).toBe(true)
  })

  it('skips the lead-time readout while the order has not shipped', () => {
    const paint = createRecordingPaint()
    drawProp(
      paint,
      prop('statuswall', { w: 6 }),
      context({ metrics: { leadTimeMs: null, reworks: 0, ciRounds: 0 } }),
      0
    )
    expect(containsColor(paint.calls, HALL.cyan)).toBe(false)
    // Zero reworks and zero CI rounds are still numbers worth drawing.
    expect(containsColor(paint.calls, HALL.red)).toBe(true)
    expect(containsColor(paint.calls, HALL.amber)).toBe(true)
  })

  it('draws no readouts at all when there is no metrics row for this order', () => {
    const withMetrics = createRecordingPaint()
    drawProp(
      withMetrics,
      prop('statuswall', { w: 6 }),
      context({ metrics: { leadTimeMs: 0, reworks: 0, ciRounds: 0 } }),
      0
    )
    const without = createRecordingPaint()
    drawProp(without, prop('statuswall', { w: 6 }), context(), 0)
    expect(containsColor(without.calls, HALL.cyan)).toBe(false)
    expect(containsColor(without.calls, HALL.red)).toBe(false)
    expect(containsColor(without.calls, HALL.amber)).toBe(false)
    expect(without.calls.length).toBeLessThan(withMetrics.calls.length)
  })
})

describe('factory/art/props bakeHall', () => {
  function baseMap(overrides: Partial<HallMap> = {}): HallMap {
    const width = 40
    const height = 30
    const solid = Array.from({ length: height }, () => Array(width).fill(false))
    const walk = solid.map((row) => [...row])
    return {
      width,
      height,
      solid,
      walk,
      props: [],
      belts: [],
      beltTiles: [],
      crossovers: [],
      breakroom: {
        x: 7,
        y: 19,
        w: 15,
        h: 5,
        door: [
          { x: 13, y: 19 },
          { x: 14, y: 19 },
        ],
      },
      restSeats: [],
      lanes: [],
      anchors: {
        intake: { x: 0, y: 4 },
        exit: { x: width - 1, y: 4 },
        archive: { x: 1, y: 3 },
        rack: { x: 2, y: 3 },
        wait: { x: 3, y: 3 },
      },
      lights: [],
      ...overrides,
    }
  }

  it('bakes without throwing and draws something', () => {
    const paint = createRecordingPaint()
    bakeHall(baseMap(), paint)
    expect(paint.calls.length).toBeGreaterThan(0)
  })

  it('bakes the hazard hatch and lane stencil for a fuller map', () => {
    const fuller = baseMap({
      props: [prop('press', { x: 5, y: 4, w: 3, h: 1 }), prop('gate', { x: 9, y: 4, w: 1, h: 1 })],
      lanes: [{ lane: 1, row: 5, label: 'Lane 1' }],
    })
    const paint = createRecordingPaint()
    expect(() => bakeHall(fuller, paint)).not.toThrow()
    expect(paint.calls.length).toBeGreaterThan(0)
  })

  it('skips the lane stencil when a lane label carries no digit', () => {
    const noDigitLane = baseMap({ lanes: [{ lane: 1, row: 5, label: 'Lane' }] })
    const paint = createRecordingPaint()
    expect(() => bakeHall(noDigitLane, paint)).not.toThrow()
  })

  it('bakes the breakroom floor colours inside map.breakroom, and confines HALL.rug to it', () => {
    const map = baseMap()
    const paint = createRecordingPaint()
    bakeHall(map, paint)

    const r = map.breakroom
    const x0 = r.x * TILE_PX
    const x1 = (r.x + r.w) * TILE_PX
    const y0 = r.y * TILE_PX
    const y1 = (r.y + r.h) * TILE_PX

    const floorInside = paint.calls.some(
      (c) =>
        c.op === 'fillRect' &&
        (c.style === '#4a4038' || c.style === '#524740') &&
        c.x >= x0 &&
        c.x < x1 &&
        c.y >= y0 &&
        c.y < y1
    )
    expect(floorInside).toBe(true)

    const rugOutside = paint.calls.some(
      (c) =>
        c.op === 'fillRect' &&
        c.style === HALL.rug &&
        (c.x < x0 || c.x >= x1 || c.y < y0 || c.y >= y1)
    )
    expect(rugOutside).toBe(false)
  })
})

describe('factory/art/props drawBelts', () => {
  function baseMap(overrides: Partial<HallMap> = {}): HallMap {
    const width = 40
    const height = 30
    const solid = Array.from({ length: height }, () => Array(width).fill(false))
    const walk = solid.map((row) => [...row])
    return {
      width,
      height,
      solid,
      walk,
      props: [],
      belts: [],
      beltTiles: [],
      crossovers: [],
      breakroom: { x: 7, y: 19, w: 15, h: 5, door: [] },
      restSeats: [],
      lanes: [],
      anchors: {
        intake: { x: 0, y: 4 },
        exit: { x: width - 1, y: 4 },
        archive: { x: 1, y: 3 },
        rack: { x: 2, y: 3 },
        wait: { x: 3, y: 3 },
      },
      lights: [],
      ...overrides,
    }
  }

  it('paints a N-S straight tile with 1-wide rails at x+2 and x+13, height 12', () => {
    const tile: BeltTile = { x: 2, y: 2, ins: ['N'], outs: ['S'], kind: 'straight', over: null }
    const map = baseMap({ beltTiles: [tile] })
    const paint = createRecordingPaint()
    drawBelts(paint, map, new Set(), 0)
    const x = tile.x * TILE_PX
    const y = tile.y * TILE_PX
    expect(hasRect(paint.calls, x + 2, y + 2, 1, 12, HALL.steelLight)).toBe(true)
    expect(hasRect(paint.calls, x + 13, y + 2, 1, 12, HALL.steelLight)).toBe(true)
  })

  it('paints an E-W straight tile with rails at y+2 and y+13', () => {
    const tile: BeltTile = { x: 5, y: 5, ins: ['W'], outs: ['E'], kind: 'straight', over: null }
    const map = baseMap({ beltTiles: [tile] })
    const paint = createRecordingPaint()
    drawBelts(paint, map, new Set(), 0)
    const x = tile.x * TILE_PX
    const y = tile.y * TILE_PX
    expect(hasRect(paint.calls, x + 2, y + 2, 12, 1, HALL.steelLight)).toBe(true)
    expect(hasRect(paint.calls, x + 2, y + 13, 12, 1, HALL.steelLight)).toBe(true)
  })

  it('paints a split junction with the amber disc', () => {
    const tile: BeltTile = { x: 12, y: 7, ins: ['N'], outs: ['E', 'S'], kind: 'split', over: null }
    const map = baseMap({ beltTiles: [tile] })
    const paint = createRecordingPaint()
    drawBelts(paint, map, new Set(), 0)
    const x = tile.x * TILE_PX
    const y = tile.y * TILE_PX
    expect(hasRect(paint.calls, x + 4, y + 5, 8, 6, HALL.amber)).toBe(true)
  })

  it('paints a merge junction with the steel disc, not amber', () => {
    const tile: BeltTile = { x: 17, y: 7, ins: ['W', 'S'], outs: ['N'], kind: 'merge', over: null }
    const map = baseMap({ beltTiles: [tile] })
    const paint = createRecordingPaint()
    drawBelts(paint, map, new Set(), 0)
    const x = tile.x * TILE_PX
    const y = tile.y * TILE_PX
    expect(hasRect(paint.calls, x + 4, y + 5, 8, 6, HALL.steel)).toBe(true)
    expect(hasRect(paint.calls, x + 4, y + 5, 8, 6, HALL.amber)).toBe(false)
  })

  it('paints the over deck for a cross tile', () => {
    const tile: BeltTile = {
      x: 26,
      y: 6,
      ins: ['W'],
      outs: ['E'],
      kind: 'cross',
      over: { from: 'N', to: 'S' },
    }
    const map = baseMap({ beltTiles: [tile] })
    const paint = createRecordingPaint()
    drawBelts(paint, map, new Set(), 0)
    expect(containsColor(paint.calls, '#20252c')).toBe(true)
  })

  it('paints a crossover over a horizontal belt as a 10x16 HALL.steelDark plate at x+3', () => {
    const tile: BeltTile = { x: 25, y: 6, ins: ['W'], outs: ['E'], kind: 'straight', over: null }
    const map = baseMap({ beltTiles: [tile], crossovers: [{ x: 25, y: 6 }] })
    const paint = createRecordingPaint()
    drawBelts(paint, map, new Set(), 0)
    const x = tile.x * TILE_PX
    const y = tile.y * TILE_PX
    expect(hasRect(paint.calls, x + 3, y, 10, 16, HALL.steelDark)).toBe(true)
  })

  it('shifts treads only while a crate rides the belt', () => {
    const tile: BeltTile = { x: 3, y: 3, ins: ['W'], outs: ['E'], kind: 'straight', over: null }
    const belt: HallBelt = {
      id: 'b1',
      fromNodeId: 'a',
      toNodeId: 'b',
      path: [{ x: 3, y: 3 }],
    }
    const map = baseMap({ beltTiles: [tile], belts: [belt] })

    const stillA = createRecordingPaint()
    drawBelts(stillA, map, new Set(), 0)
    const stillB = createRecordingPaint()
    drawBelts(stillB, map, new Set(), 500)
    expect(stillA.calls).toEqual(stillB.calls)

    const movingA = createRecordingPaint()
    drawBelts(movingA, map, new Set(['b1']), 0)
    const movingB = createRecordingPaint()
    drawBelts(movingB, map, new Set(['b1']), 500)
    expect(movingA.calls).not.toEqual(movingB.calls)
  })
})

describe('factory/art/props drawCrate', () => {
  it('draws a crate without throwing', () => {
    const paint = createRecordingPaint()
    expect(() => drawCrate(paint, 10, 10)).not.toThrow()
    expect(paint.calls.length).toBeGreaterThan(0)
  })
})

describe('factory/art/props drawQueuePlate', () => {
  const exit: Tile = { x: 10, y: 8 }

  it('draws nothing when the order is not queued behind anything', () => {
    const paint = createRecordingPaint()
    drawQueuePlate(paint, exit, context(), 0)
    expect(paint.calls).toHaveLength(0)
  })

  it('draws the plate once a queue position is on the scene context', () => {
    const paint = createRecordingPaint()
    drawQueuePlate(paint, exit, context({ queue: { position: 2 } }), 0)
    expect(paint.calls.length).toBeGreaterThan(0)
  })

  it('flashes the beacon on the same clock as a waiting gate', () => {
    const t0 = createRecordingPaint()
    drawQueuePlate(t0, exit, context({ queue: { position: 1 } }), 0)
    const t1 = createRecordingPaint()
    drawQueuePlate(t1, exit, context({ queue: { position: 1 } }), 250)
    expect(t0.calls).not.toEqual(t1.calls)
  })

  it('draws the same plate regardless of position value beyond the digits shown', () => {
    const paint = createRecordingPaint()
    expect(() => drawQueuePlate(paint, exit, context({ queue: { position: 12 } }), 0)).not.toThrow()
    expect(paint.calls.length).toBeGreaterThan(0)
  })
})
