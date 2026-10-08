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
    sign: null,
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

  describe.each(['desk', 'rig', 'bench', 'press'] as const)('the %s status lamp', (kind) => {
    const lamp = (over: Partial<SceneContext>, tMs = 0) => {
      const paint = createRecordingPaint()
      drawProp(paint, prop(kind), context(over), tMs)
      return paint.calls
    }

    it('flashes while its step is working, on and off with the clock', () => {
      const on = lamp({ states: { n1: 'running' } }, 0)
      const off = lamp({ states: { n1: 'running' } }, 500)
      expect(containsColor(on, HALL.cyan)).toBe(true)
      expect(containsColor(off, HALL.cyan)).toBe(false)
      expect(containsColor(lamp({ states: { n1: 'verifying' } }, 0), HALL.cyan)).toBe(true)
    })

    it('burns orange while its step needs you, over the working flash', () => {
      const calls = lamp({ states: { n1: 'running' }, needsYou: ['n1'] })
      expect(containsColor(calls, HALL.orange)).toBe(true)
      expect(containsColor(calls, HALL.cyan)).toBe(false)
    })

    it('burns red while its step has failed, is blocked, or has lost its agent', () => {
      expect(containsColor(lamp({ states: { n1: 'failed' } }), HALL.red)).toBe(true)
      expect(containsColor(lamp({ states: { n1: 'blocked' } }), HALL.red)).toBe(true)
      expect(containsColor(lamp({ states: { n1: 'running' }, orphaned: ['n1'] }), HALL.red)).toBe(
        true
      )
    })

    it('burns green once its step is done, and stays dark before it starts', () => {
      expect(containsColor(lamp({ states: { n1: 'passed' } }), HALL.green)).toBe(true)
      for (const state of ['waiting', 'ready', 'skipped'] as const) {
        const calls = lamp({ states: { n1: state } })
        for (const lit of [HALL.cyan, HALL.orange, HALL.red, HALL.green]) {
          expect(containsColor(calls, lit)).toBe(false)
        }
      }
    })
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

  describe('station name stencils', () => {
    const STENCIL = 'rgba(224,161,58,.55)'
    const stencilRects = (calls: readonly PaintCall[]): PaintCall[] =>
      calls.filter((c) => c.op === 'fillRect' && c.style === STENCIL)

    it('paints a desk name centred in the row above it, from the one glyph table', () => {
      const paint = createRecordingPaint()
      bakeHall(baseMap({ props: [prop('desk', { x: 4, y: 6, w: 3, sign: 'A' })] }), paint)
      // 'A' is 010 / 101 / 111 / 101 / 101: three wide, centred in 48px.
      const sx = 4 * TILE_PX + Math.floor((3 * TILE_PX - 3) / 2)
      const sy = 6 * TILE_PX - 15
      expect(hasRect(paint.calls, sx + 1, sy, 1, 1, STENCIL)).toBe(true)
      expect(hasRect(paint.calls, sx, sy, 1, 1, STENCIL)).toBe(false)
      expect(hasRect(paint.calls, sx, sy + 1, 1, 1, STENCIL)).toBe(true)
      expect(stencilRects(paint.calls)).toHaveLength(10)
    })

    it.each(['press', 'gate'] as const)('paints a %s name below its footprint', (kind) => {
      const paint = createRecordingPaint()
      const p = prop(kind, { x: 4, y: 6, sign: '-' })
      bakeHall(baseMap({ props: [p] }), paint)
      const sx = p.x * TILE_PX + Math.floor((p.w * TILE_PX - 3) / 2)
      const sy = (p.y + p.h) * TILE_PX + 9
      expect(hasRect(paint.calls, sx, sy + 2, 1, 1, STENCIL)).toBe(true)
      expect(stencilRects(paint.calls)).toHaveLength(3)
    })

    it('paints nothing for props without a sign', () => {
      const paint = createRecordingPaint()
      bakeHall(
        baseMap({ props: [prop('desk', { sign: null }), prop('shelves', { sign: null })] }),
        paint
      )
      expect(stencilRects(paint.calls)).toHaveLength(0)
    })
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

  it('paints a split junction as the small grey hub with a dim chevron down each outgoing belt', () => {
    const tile: BeltTile = { x: 12, y: 7, ins: ['N'], outs: ['E', 'S'], kind: 'split', over: null }
    const map = baseMap({ beltTiles: [tile] })
    const paint = createRecordingPaint()
    drawBelts(paint, map, new Set(), 0)
    const x = tile.x * TILE_PX
    const y = tile.y * TILE_PX
    expect(hasRect(paint.calls, x + 6, y + 6, 4, 4, '#20252c')).toBe(true)
    expect(hasRect(paint.calls, x + 7, y + 7, 2, 2, HALL.steelDark)).toBe(true)
    expect(containsColor(paint.calls, HALL.amber)).toBe(false)
    expect(containsColor(paint.calls, HALL.amberDim)).toBe(true)
  })

  it('paints a merge junction exactly like a split with one out', () => {
    const merge: BeltTile = { x: 17, y: 7, ins: ['W', 'S'], outs: ['N'], kind: 'merge', over: null }
    const split: BeltTile = { ...merge, kind: 'split' }
    const mergePaint = createRecordingPaint()
    drawBelts(mergePaint, baseMap({ beltTiles: [merge] }), new Set(), 0)
    const splitPaint = createRecordingPaint()
    drawBelts(splitPaint, baseMap({ beltTiles: [split] }), new Set(), 0)
    expect(containsColor(mergePaint.calls, HALL.amber)).toBe(false)
    expect(mergePaint.calls).toEqual(splitPaint.calls)
  })

  it('hangs the vending machine on the wall face instead of over the floor', () => {
    const paint = createRecordingPaint()
    bakeHall(baseMap(), paint)
    const body = paint.calls.filter((c) => c.op === 'fillRect' && c.style === '#8a2f2a')
    expect(body.length).toBeGreaterThan(0)
    for (const c of body) {
      if (c.op === 'fillRect') expect(c.y + c.h).toBeLessThanOrEqual(3 * TILE_PX)
    }
  })

  it('keeps every partition rect between its side walls, so the glazing does not overhang them', () => {
    const paint = createRecordingPaint()
    const p = prop('partition')
    drawProp(paint, p, context(), 0)
    const left = p.x * TILE_PX + 10
    const right = (p.x + p.w) * TILE_PX - 10
    const rects = paint.calls.filter((c) => c.op === 'fillRect')
    expect(rects.length).toBeGreaterThan(0)
    for (const c of rects) {
      if (c.op !== 'fillRect') continue
      expect(c.x).toBeGreaterThanOrEqual(left)
      expect(c.x + c.w).toBeLessThanOrEqual(right)
    }
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

describe('factory/art/props station work', () => {
  const STAGES = [0, 300, 714, 1500, 5000]
  const draw = (kind: PropKind, ctx: SceneContext, tMs: number, over: Partial<HallProp> = {}) => {
    const paint = createRecordingPaint()
    drawProp(paint, prop(kind, over), ctx, tMs)
    return paint.calls
  }

  describe('desk screens', () => {
    const SHELL = '#040907'
    const PAGE = '#161e2a'
    const EDIT = '#1f5566'
    const tools = (t: 'rack' | 'archive' | 'desk') => context({ tools: { n1: t } })

    it.each([
      ['rack', SHELL],
      ['archive', PAGE],
      ['desk', EDIT],
    ] as const)('shows the %s tool only while that tool is open', (tool, color) => {
      for (const t of STAGES) {
        expect(containsColor(draw('desk', tools(tool), t), color)).toBe(true)
        expect(containsColor(draw('desk', context(), t), color)).toBe(false)
      }
    })

    it('shows one tool screen at a time', () => {
      const calls = draw('desk', tools('rack'), 0)
      expect(containsColor(calls, PAGE)).toBe(false)
      expect(containsColor(calls, EDIT)).toBe(false)
    })

    it('reads the tool of its own node only', () => {
      expect(containsColor(draw('desk', context({ tools: { other: 'rack' } }), 0), SHELL)).toBe(
        false
      )
    })

    it('lights the screens for an open tool call with nobody typing', () => {
      expect(containsColor(draw('desk', tools('desk'), 0), HALL.screenOn)).toBe(true)
      expect(containsColor(draw('desk', context(), 0), HALL.screenOn)).toBe(false)
    })

    it('keeps the plain code lines for a typist with no tool call open', () => {
      const typing = context({ crew: [crew({ anim: 'type' })] })
      const calls = draw('desk', typing, 300)
      expect(containsColor(calls, HALL.screenOn)).toBe(true)
      for (const c of [SHELL, PAGE, EDIT]) expect(containsColor(calls, c)).toBe(false)
    })

    it('presses a key under the typist only while somebody types', () => {
      const KEY = '#d8e6f5'
      for (const t of STAGES) {
        expect(
          containsColor(draw('desk', context({ crew: [crew({ anim: 'type' })] }), t), KEY)
        ).toBe(true)
        expect(containsColor(draw('desk', tools('desk'), t), KEY)).toBe(false)
        expect(containsColor(draw('desk', context(), t), KEY)).toBe(false)
      }
    })
  })

  describe('rig', () => {
    const FAN = '#11141a'
    const PULSE = '#fff4c2'
    const scanning = context({ crew: [crew({ anim: 'scan' })] })

    it('runs its ticker, cable pulses and fan only while a crew member scans', () => {
      for (const t of STAGES) {
        for (const color of [FAN, PULSE]) {
          expect(containsColor(draw('rig', scanning, t), color)).toBe(true)
          expect(containsColor(draw('rig', context(), t), color)).toBe(false)
          expect(containsColor(draw('rig', context({ states: { n1: 'running' } }), t), color)).toBe(
            false
          )
        }
      }
      // Six ticks in: the sixth reading is amber.
      expect(
        hasRect(draw('rig', scanning, 840), 4 * TILE_PX + 14, 4 * TILE_PX + 4, 1, 1, HALL.amber)
      ).toBe(true)
      expect(
        hasRect(draw('rig', context(), 840), 4 * TILE_PX + 14, 4 * TILE_PX + 4, 1, 1, HALL.amber)
      ).toBe(false)
    })

    it('flashes a tick or a cross only inside the verdict window', () => {
      const PASS_BG = '#0d2412'
      const FAIL_BG = '#2a0f0b'
      const verdicts = (pass: boolean) => context({ verdicts: [{ nodeId: 'n1', pass, at: 1000 }] })
      for (const [t, shown] of [
        [999, false],
        [1000, true],
        [2599, true],
        [2600, false],
        [9000, false],
      ] as const) {
        expect(containsColor(draw('rig', verdicts(true), t), PASS_BG)).toBe(shown)
        expect(containsColor(draw('rig', verdicts(false), t), FAIL_BG)).toBe(shown)
      }
      expect(containsColor(draw('rig', verdicts(true), 1500), FAIL_BG)).toBe(false)
      expect(containsColor(draw('rig', verdicts(false), 1500), PASS_BG)).toBe(false)
    })

    it('ignores a verdict on another step', () => {
      const other = context({ verdicts: [{ nodeId: 'zz', pass: true, at: 1000 }] })
      expect(containsColor(draw('rig', other, 1500), '#0d2412')).toBe(false)
    })

    it('shows the newest of two verdicts on one step', () => {
      const both = context({
        verdicts: [
          { nodeId: 'n1', pass: false, at: 1000 },
          { nodeId: 'n1', pass: true, at: 1200 },
        ],
      })
      const calls = draw('rig', both, 1300)
      expect(containsColor(calls, '#0d2412')).toBe(true)
      expect(containsColor(calls, '#2a0f0b')).toBe(false)
    })
  })

  describe('bench', () => {
    const SHEET = '#d9dde2'
    const STRIP = '#e9ecef'
    const scanning = context({ crew: [crew({ anim: 'scan' })] })

    it('lays out the sheet, scan line and report strip only while scanning', () => {
      for (const t of STAGES) {
        for (const color of [SHEET, STRIP, 'rgba(114,216,242,.9)']) {
          expect(containsColor(draw('bench', scanning, t), color)).toBe(true)
          expect(containsColor(draw('bench', context(), t), color)).toBe(false)
        }
      }
    })

    it('stamps the sheet inside the verdict window, without a report strip', () => {
      const verdicts = (pass: boolean) => context({ verdicts: [{ nodeId: 'n1', pass, at: 500 }] })
      for (const [t, shown] of [
        [499, false],
        [500, true],
        [2099, true],
        [2100, false],
      ] as const) {
        expect(containsColor(draw('bench', verdicts(true), t), '#3a8a4a')).toBe(shown)
        expect(containsColor(draw('bench', verdicts(false), t), '#b04a3c')).toBe(shown)
      }
      const stamped = draw('bench', verdicts(true), 600)
      expect(containsColor(stamped, SHEET)).toBe(true)
      expect(containsColor(stamped, STRIP)).toBe(false)
      expect(containsColor(stamped, 'rgba(114,216,242,.9)')).toBe(false)
    })
  })

  describe('press', () => {
    const BEACON = '#20242c'
    const SPARK = '#ffd27a'
    const HEAD = '#6b7482'
    const headY = (calls: readonly PaintCall[]): number[] =>
      calls
        .filter((c) => c.op === 'fillRect' && c.style === HEAD)
        .map((c) => (c as { y: number }).y)

    it.each(['running', 'verifying'] as const)(
      'works while its step is %s, with no crew at all',
      (state) => {
        const ctx = context({ states: { n1: state } })
        for (const t of STAGES) expect(containsColor(draw('press', ctx, t), BEACON)).toBe(true)
        expect(containsColor(draw('press', ctx, 714), SPARK)).toBe(true)
        expect(containsColor(draw('press', ctx, 0), SPARK)).toBe(false)
        expect(headY(draw('press', ctx, 0))).not.toEqual(headY(draw('press', ctx, 714)))
      }
    )

    it.each(['waiting', 'ready', 'passed', 'failed', 'blocked'] as const)(
      'stands still while its step is %s, even with a crew member typing',
      (state) => {
        const ctx = context({ states: { n1: state }, crew: [crew({ anim: 'type' })] })
        for (const t of STAGES) {
          const calls = draw('press', ctx, t)
          expect(containsColor(calls, BEACON)).toBe(false)
          expect(containsColor(calls, SPARK)).toBe(false)
          expect(headY(calls)).toEqual(headY(draw('press', ctx, 0)))
        }
      }
    )

    it('crawls the guard-rail stripes only while working', () => {
      const work = context({ states: { n1: 'running' } })
      const stripe = (ctx: SceneContext, t: number) =>
        hasRect(draw('press', ctx, t), 4 * TILE_PX + 2, 3 * TILE_PX + 4 + 6, 4, 3, HALL.amber)
      // Stripe row 1 is amber once the crawl has moved it by six.
      expect(stripe(work, 0)).toBe(false)
      expect(stripe(work, 720)).toBe(true)
      expect(stripe(context(), 720)).toBe(false)
    })
  })

  describe('gate arm', () => {
    const at = 1000
    const swing = (pass: boolean) => context({ verdicts: [{ nodeId: 'n1', pass, at }] })
    const x = 4 * TILE_PX
    const y = 4 * TILE_PX
    const lowered = (calls: readonly PaintCall[]) =>
      hasRect(calls, x + 1, y - 4, TILE_PX - 2, 3, '#e9ecef')
    const raised = (calls: readonly PaintCall[]) => hasRect(calls, x, y - 20, 2, 16, '#e9ecef')
    const segments = (calls: readonly PaintCall[]) =>
      calls.filter((c) => c.op === 'fillRect' && c.w === 2 && c.h === 2 && c.style === '#e9ecef')

    it('swings mid-way for 400ms after a pass — neither lowered nor raised', () => {
      for (const t of [1000, 1150, 1399]) {
        const calls = draw('gate', swing(true), t)
        expect(lowered(calls)).toBe(false)
        expect(raised(calls)).toBe(false)
        expect(segments(calls).length).toBeGreaterThan(0)
      }
    })

    it('steps the arm up through different angles', () => {
      const a = segments(draw('gate', swing(true), 1000))
      const b = segments(draw('gate', swing(true), 1399))
      expect(a).not.toEqual(b)
    })

    it('snaps back to raised (passed) or lowered (not passed) once the swing is over', () => {
      expect(
        raised(
          draw(
            'gate',
            context({ states: { n1: 'passed' }, verdicts: [{ nodeId: 'n1', pass: true, at }] }),
            1400
          )
        )
      ).toBe(true)
      expect(lowered(draw('gate', swing(true), 1400))).toBe(true)
      expect(segments(draw('gate', swing(true), 1400))).toHaveLength(0)
    })

    it('does not swing before the pass or for a failure', () => {
      expect(lowered(draw('gate', swing(true), 999))).toBe(true)
      expect(lowered(draw('gate', swing(false), 1100))).toBe(true)
      expect(segments(draw('gate', swing(false), 1100))).toHaveLength(0)
    })
  })

  describe('racks and shelves', () => {
    const SLID = '#3c4351'
    const PULLED = '#e8c56a'
    const at = (reaching: readonly ('archive' | 'rack')[]) => context({ reaching })

    it('slides a rack unit out and works its lights only while someone reaches for the rack', () => {
      for (const t of STAGES) {
        expect(containsColor(draw('racks', at(['rack']), t), SLID)).toBe(true)
        expect(containsColor(draw('racks', at(['archive']), t), SLID)).toBe(false)
        expect(containsColor(draw('racks', context(), t), SLID)).toBe(false)
        expect(containsColor(draw('racks', at(['rack']), t), HALL.cyan)).toBe(true)
        expect(containsColor(draw('racks', context(), t), HALL.cyan)).toBe(false)
      }
    })

    it('leaves the idle rack blink exactly as it was when nobody reaches', () => {
      for (const t of STAGES)
        expect(draw('racks', at(['archive']), t)).toEqual(draw('racks', context(), t))
    })

    it('pulls a book only while someone reaches for the archive', () => {
      for (const t of STAGES) {
        expect(containsColor(draw('shelves', at(['archive']), t), PULLED)).toBe(true)
        expect(containsColor(draw('shelves', at(['rack']), t), PULLED)).toBe(false)
        expect(containsColor(draw('shelves', context(), t), PULLED)).toBe(false)
      }
    })

    it('draws the dust speck on a beat of the clock', () => {
      const dust = (t: number) => containsColor(draw('shelves', at(['archive']), t), '#ffffff')
      expect(dust(0)).toBe(true)
      expect(dust(150)).toBe(true)
    })
  })
})
