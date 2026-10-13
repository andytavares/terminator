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
// otherwise — regardless of the clock. Breakroom furniture (restbench, sofa,
// table, fridge, coffeebar, vending, partition) never reads `SceneContext`
// at all: it draws the same regardless of crew or clock.

const ALL_PROP_KINDS: readonly PropKind[] = [
  'desk',
  'rig',
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

/** Whether a rect exactly at [x, y, w, h] was filled with `style`. */
function hasRect(
  calls: readonly PaintCall[],
  [x, y, w, h]: [number, number, number, number],
  style: string
): boolean {
  return calls.some(
    (c) =>
      c.op === 'fillRect' && c.x === x && c.y === y && c.w === w && c.h === h && c.style === style
  )
}

/** The anchors of a hall `width` tiles wide: in and out on row 4, the rest top left. */
function anchors(width: number): HallMap['anchors'] {
  return {
    intake: { x: 0, y: 4 },
    exit: { x: width - 1, y: 4 },
    archive: { x: 1, y: 3 },
    rack: { x: 2, y: 3 },
    wait: { x: 3, y: 3 },
  }
}

/** An empty 40 by 30 hall whose breakroom has no door. */
function baseMap(overrides: Partial<HallMap> = {}): HallMap {
  const width = 40
  const height = 30
  const solid = Array.from({ length: height }, () => Array(width).fill(false))
  return {
    width,
    height,
    solid,
    walk: solid.map((row) => [...row]),
    props: [],
    belts: [],
    beltTiles: [],
    crossovers: [],
    breakroom: { x: 7, y: 19, w: 15, h: 5, door: [] },
    restSeats: [],
    lanes: [],
    anchors: anchors(width),
    lights: [],
    ...overrides,
  }
}

/** The hall `bakeHall` is given: the breakroom opens on two tiles of its top wall. */
const bakedMap = (overrides: Partial<HallMap> = {}) =>
  baseMap({
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
    ...overrides,
  })

type Lamp = (over: Partial<SceneContext>, tMs?: number) => readonly PaintCall[]

/** What a `kind` prop of node n1 paints in the scene `over` describes. */
function lampOf(kind: PropKind): Lamp {
  return (over, tMs = 0) => {
    const paint = createRecordingPaint()
    drawProp(paint, prop(kind), { context: context(over), tMs })
    return paint.calls
  }
}

const STAGES = [0, 300, 714, 1500, 5000]

/** The calls a `kind` prop paints in `ctx` at `tMs`. */
function draw(kind: PropKind, ctx: SceneContext, tMs: number) {
  const paint = createRecordingPaint()
  drawProp(paint, prop(kind), { context: ctx, tMs })
  return paint.calls
}

describe('factory/art/props drawProp', () => {
  describe('every kind and desks', everyKindAndDesksTests)
  describe('rigs, benches and gates', rigsBenchesAndGatesTests)

  describe.each(['desk', 'rig', 'press'] as const)('the %s status lamp', (kind) => {
    describe('working and needing you', () => workingLampTests(lampOf(kind)))
    describe('failed and done', () => settledLampTests(lampOf(kind)))
  })
  describe('beacons and chairs', beaconsAndChairsTests)
  describe('the dispatch tower', theDispatchTowerTests)
  describe('the status wall', theStatusWallTests)
  describe('no metrics row', noMetricsRowTests)
})

function everyKindAndDesksTests() {
  it('draws every PropKind without throwing', () => {
    for (const kind of ALL_PROP_KINDS) {
      const paint = createRecordingPaint()
      expect(() => drawProp(paint, prop(kind), { context: context(), tMs: 1234 })).not.toThrow()
      expect(paint.calls.length).toBeGreaterThan(0)
    }
  })

  it('lights a desk only when a present crew member of its own node is typing', () => {
    const desk = lampOf('desk')
    const lit = (one: Partial<Crew>) => containsColor(desk({ crew: [crew(one)] }), HALL.screenOn)
    expect(lit({ nodeId: 'n1', anim: 'type' })).toBe(true)
    expect(lit({ nodeId: 'n1', anim: 'idle' })).toBe(false)
    expect(lit({ nodeId: 'n1', anim: 'type', present: false })).toBe(false)
    expect(lit({ nodeId: 'n2', anim: 'type' })).toBe(false)
  })
}

function rigsBenchesAndGatesTests() {
  it('draws a rig waveform only while its crew scans', () => {
    const rig = lampOf('rig')
    const waving = (one: Partial<Crew>) => containsColor(rig({ crew: [crew(one)] }), HALL.green)
    expect(waving({ nodeId: 'n1', anim: 'scan' })).toBe(true)
    expect(waving({ nodeId: 'n1', anim: 'idle' })).toBe(false)
  })

  it('draws a rest bench identically regardless of crew or clock — it is breakroom furniture, not a station', () => {
    const scanning = createRecordingPaint()
    drawProp(scanning, prop('restbench'), {
      context: context({ crew: [crew({ nodeId: 'n1', anim: 'scan' })] }),
      tMs: 0,
    })

    const idleLater = createRecordingPaint()
    drawProp(idleLater, prop('restbench'), { context: context(), tMs: 900 })

    expect(scanning.calls).toEqual(idleLater.calls)
    expect(scanning.calls.length).toBeGreaterThan(0)
  })

  it('draws the gate arm open when its node has passed', () => {
    const open = createRecordingPaint()
    drawProp(open, prop('gate'), { context: context({ states: { n1: 'passed' } }), tMs: 0 })
    expect(open.calls.length).toBeGreaterThan(0)
  })
}

function beaconsAndChairsTests() {
  it('flashes the gate beacon only while its node is in gatesWaiting', () => {
    const t0 = createRecordingPaint()
    drawProp(t0, prop('gate'), { context: context({ gatesWaiting: ['n1'] }), tMs: 0 })
    const t1 = createRecordingPaint()
    drawProp(t1, prop('gate'), { context: context({ gatesWaiting: ['n1'] }), tMs: 250 })
    expect(t0.calls).not.toEqual(t1.calls)

    const idleT0 = createRecordingPaint()
    drawProp(idleT0, prop('gate'), { context: context(), tMs: 0 })
    const idleT1 = createRecordingPaint()
    drawProp(idleT1, prop('gate'), { context: context(), tMs: 250 })
    expect(idleT0.calls).toEqual(idleT1.calls)
  })

  it('hides the chair silhouette only while its owner is typing', () => {
    const seated = createRecordingPaint()
    drawProp(seated, prop('chair'), {
      context: context({ crew: [crew({ nodeId: 'n1', anim: 'type' })] }),
      tMs: 0,
    })
    expect(containsColor(seated.calls, '#3a4150')).toBe(false)

    const empty = createRecordingPaint()
    drawProp(empty, prop('chair'), { context: context(), tMs: 0 })
    expect(containsColor(empty.calls, '#3a4150')).toBe(true)
  })
}

function theDispatchTowerTests() {
  it('lights the dispatch tower with one lamp per check, coloured by bucket', () => {
    const paint = createRecordingPaint()
    drawProp(paint, prop('dispatch'), {
      context: context({ ci: { checks: { test: 'fail', lint: 'pass', typecheck: 'pending' } } }),
      tMs: 0,
    })
    expect(containsColor(paint.calls, HALL.red)).toBe(true)
    expect(containsColor(paint.calls, HALL.green)).toBe(true)
    expect(containsColor(paint.calls, HALL.amber)).toBe(true)
  })

  it('draws no lamps for a dispatch tower nothing has reported checks for', () => {
    const paint = createRecordingPaint()
    drawProp(paint, prop('dispatch'), { context: context({ ci: { checks: {} } }), tMs: 0 })
    expect(containsColor(paint.calls, HALL.red)).toBe(false)
    expect(containsColor(paint.calls, HALL.green)).toBe(false)
  })
}

function theStatusWallTests() {
  it('draws the status wall the order metrics own numbers', () => {
    const paint = createRecordingPaint()
    drawProp(paint, prop('statuswall', { w: 6 }), {
      context: context({ metrics: { leadTimeMs: 80 * 60_000, reworks: 2, ciRounds: 3 } }),
      tMs: 0,
    })
    expect(containsColor(paint.calls, HALL.cyan)).toBe(true)
    expect(containsColor(paint.calls, HALL.red)).toBe(true)
    expect(containsColor(paint.calls, HALL.amber)).toBe(true)
  })

  it('skips the lead-time readout while the order has not shipped', () => {
    const paint = createRecordingPaint()
    drawProp(paint, prop('statuswall', { w: 6 }), {
      context: context({ metrics: { leadTimeMs: null, reworks: 0, ciRounds: 0 } }),
      tMs: 0,
    })
    expect(containsColor(paint.calls, HALL.cyan)).toBe(false)
    // Zero reworks and zero CI rounds are still numbers worth drawing.
    expect(containsColor(paint.calls, HALL.red)).toBe(true)
    expect(containsColor(paint.calls, HALL.amber)).toBe(true)
  })
}

function noMetricsRowTests() {
  it('draws no readouts at all when there is no metrics row for this order', () => {
    const withMetrics = createRecordingPaint()
    drawProp(withMetrics, prop('statuswall', { w: 6 }), {
      context: context({ metrics: { leadTimeMs: 0, reworks: 0, ciRounds: 0 } }),
      tMs: 0,
    })
    const without = createRecordingPaint()
    drawProp(without, prop('statuswall', { w: 6 }), { context: context(), tMs: 0 })
    expect(containsColor(without.calls, HALL.cyan)).toBe(false)
    expect(containsColor(without.calls, HALL.red)).toBe(false)
    expect(containsColor(without.calls, HALL.amber)).toBe(false)
    expect(without.calls.length).toBeLessThan(withMetrics.calls.length)
  })
}

function workingLampTests(lamp: Lamp) {
  it('flashes while its step is working, on and off with the clock', () => {
    const on = lamp({ states: { n1: 'running' } }, 0)
    const off = lamp({ states: { n1: 'running' } }, 500)
    expect(containsColor(on, HALL.cyan)).toBe(true)
    expect(containsColor(off, HALL.cyan)).toBe(false)
  })

  it('burns orange while its step needs you, over the working flash', () => {
    const calls = lamp({ states: { n1: 'running' }, needsYou: ['n1'] })
    expect(containsColor(calls, HALL.orange)).toBe(true)
    expect(containsColor(calls, HALL.cyan)).toBe(false)
  })
}

function settledLampTests(lamp: Lamp) {
  it('burns red while its step has failed, is blocked, or has lost its agent', () => {
    expect(containsColor(lamp({ states: { n1: 'failed' } }), HALL.red)).toBe(true)
    expect(containsColor(lamp({ states: { n1: 'blocked' } }), HALL.red)).toBe(true)
    expect(containsColor(lamp({ states: { n1: 'running' }, orphaned: ['n1'] }), HALL.red)).toBe(
      true
    )
  })

  it('burns green once its step is done, and stays dark before it starts', () => {
    expect(containsColor(lamp({ states: { n1: 'passed' } }), HALL.green)).toBe(true)
    for (const state of ['waiting', 'skipped'] as const) {
      const calls = lamp({ states: { n1: state } })
      for (const lit of [HALL.cyan, HALL.orange, HALL.red, HALL.green]) {
        expect(containsColor(calls, lit)).toBe(false)
      }
    }
  })
}

const STENCIL = 'rgba(224,161,58,.55)'
const stencilRects = (calls: readonly PaintCall[]): PaintCall[] =>
  calls.filter((c) => c.op === 'fillRect' && c.style === STENCIL)

interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
}

/** The breakroom of `map`, in pixels. */
function breakroomBox(map: HallMap): Box {
  const r = map.breakroom
  return {
    x0: r.x * TILE_PX,
    x1: (r.x + r.w) * TILE_PX,
    y0: r.y * TILE_PX,
    y1: (r.y + r.h) * TILE_PX,
  }
}

/** Whether a fill starts inside `box`. */
function inside(call: PaintCall, box: Box): boolean {
  if (call.op !== 'fillRect') return false
  return call.x >= box.x0 && call.x < box.x1 && call.y >= box.y0 && call.y < box.y1
}

describe('factory/art/props bakeHall', () => {
  describe('the hall', theHallTests)
  describe('the breakroom', theBreakroomTests)

  describe('station name stencils', () => {
    describe('desk names', deskNamesTests)
    describe('props below and unsigned', propsBelowAndUnsignedTests)
  })
})

function theHallTests() {
  it('bakes without throwing and draws something', () => {
    const paint = createRecordingPaint()
    bakeHall(bakedMap(), paint)
    expect(paint.calls.length).toBeGreaterThan(0)
  })

  it('bakes the hazard hatch and lane stencil for a fuller map', () => {
    const fuller = bakedMap({
      props: [prop('press', { x: 5, y: 4, w: 3, h: 1 }), prop('gate', { x: 9, y: 4, w: 1, h: 1 })],
      lanes: [{ lane: 1, row: 5, label: 'Lane 1' }],
    })
    const paint = createRecordingPaint()
    expect(() => bakeHall(fuller, paint)).not.toThrow()
    expect(paint.calls.length).toBeGreaterThan(0)
  })

  it('skips the lane stencil when a lane label carries no digit', () => {
    const noDigitLane = bakedMap({ lanes: [{ lane: 1, row: 5, label: 'Lane' }] })
    const paint = createRecordingPaint()
    expect(() => bakeHall(noDigitLane, paint)).not.toThrow()
  })
}

function theBreakroomTests() {
  it('bakes the breakroom floor colours inside map.breakroom, and confines HALL.rug to it', () => {
    const map = bakedMap()
    const paint = createRecordingPaint()
    bakeHall(map, paint)

    const room = breakroomBox(map)
    const fills = paint.calls.filter((c) => c.op === 'fillRect')
    const floor = fills.filter((c) => c.style === '#4a4038' || c.style === '#524740')
    expect(floor.some((c) => inside(c, room))).toBe(true)
    const rug = fills.filter((c) => c.style === HALL.rug)
    expect(rug.some((c) => !inside(c, room))).toBe(false)
  })
}

function deskNamesTests() {
  it('paints a desk name centred in the row above it, from the one glyph table', () => {
    const paint = createRecordingPaint()
    bakeHall(bakedMap({ props: [prop('desk', { x: 4, y: 6, w: 3, sign: 'A' })] }), paint)
    // 'A' is 010 / 101 / 111 / 101 / 101: three wide, centred in 48px.
    const sx = 4 * TILE_PX + Math.floor((3 * TILE_PX - 3) / 2)
    const sy = 6 * TILE_PX - 15
    expect(hasRect(paint.calls, [sx + 1, sy, 1, 1], STENCIL)).toBe(true)
    expect(hasRect(paint.calls, [sx, sy, 1, 1], STENCIL)).toBe(false)
    expect(hasRect(paint.calls, [sx, sy + 1, 1, 1], STENCIL)).toBe(true)
    expect(stencilRects(paint.calls)).toHaveLength(10)
  })
}

function propsBelowAndUnsignedTests() {
  it.each(['press', 'gate'] as const)('paints a %s name below its footprint', (kind) => {
    const paint = createRecordingPaint()
    const p = prop(kind, { x: 4, y: 6, sign: '-' })
    bakeHall(bakedMap({ props: [p] }), paint)
    const sx = p.x * TILE_PX + Math.floor((p.w * TILE_PX - 3) / 2)
    const sy = (p.y + p.h) * TILE_PX + 9
    expect(hasRect(paint.calls, [sx, sy + 2, 1, 1], STENCIL)).toBe(true)
    expect(stencilRects(paint.calls)).toHaveLength(3)
  })

  it('paints nothing for props without a sign', () => {
    const paint = createRecordingPaint()
    bakeHall(
      bakedMap({ props: [prop('desk', { sign: null }), prop('shelves', { sign: null })] }),
      paint
    )
    expect(stencilRects(paint.calls)).toHaveLength(0)
  })
}

describe('factory/art/props drawBelts', () => {
  describe('straight tiles', straightTilesTests)
  describe('junctions', junctionsTests)
  describe('corners', cornerTilesTests)
  describe('wall fixtures', wallFixturesTests)
  describe('cross tiles', crossTilesTests)
  describe('crossing at right angles', rightAngleCrossingTests)
  describe('treads', treadsTests)
})

function straightTilesTests() {
  it('paints a N-S straight tile with 1-wide rails at x+2 and x+13, height 12', () => {
    const tile: BeltTile = { x: 2, y: 2, ins: ['N'], outs: ['S'], kind: 'straight', over: null }
    const map = baseMap({ beltTiles: [tile] })
    const paint = createRecordingPaint()
    drawBelts(paint, map, { movingBeltIds: new Set(), tMs: 0 })
    const x = tile.x * TILE_PX
    const y = tile.y * TILE_PX
    expect(hasRect(paint.calls, [x + 2, y + 2, 1, 12], HALL.steelLight)).toBe(true)
    expect(hasRect(paint.calls, [x + 13, y + 2, 1, 12], HALL.steelLight)).toBe(true)
  })

  it('paints an E-W straight tile with rails at y+2 and y+13', () => {
    const tile: BeltTile = { x: 5, y: 5, ins: ['W'], outs: ['E'], kind: 'straight', over: null }
    const map = baseMap({ beltTiles: [tile] })
    const paint = createRecordingPaint()
    drawBelts(paint, map, { movingBeltIds: new Set(), tMs: 0 })
    const x = tile.x * TILE_PX
    const y = tile.y * TILE_PX
    expect(hasRect(paint.calls, [x + 2, y + 2, 12, 1], HALL.steelLight)).toBe(true)
    expect(hasRect(paint.calls, [x + 2, y + 13, 12, 1], HALL.steelLight)).toBe(true)
  })
}

function junctionsTests() {
  it('paints a split junction as the small grey hub with a dim chevron down each outgoing belt', () => {
    const tile: BeltTile = { x: 12, y: 7, ins: ['N'], outs: ['E', 'S'], kind: 'split', over: null }
    const map = baseMap({ beltTiles: [tile] })
    const paint = createRecordingPaint()
    drawBelts(paint, map, { movingBeltIds: new Set(), tMs: 0 })
    const x = tile.x * TILE_PX
    const y = tile.y * TILE_PX
    expect(hasRect(paint.calls, [x + 6, y + 6, 4, 4], '#20252c')).toBe(true)
    expect(hasRect(paint.calls, [x + 7, y + 7, 2, 2], HALL.steelDark)).toBe(true)
    expect(containsColor(paint.calls, HALL.amber)).toBe(false)
    expect(containsColor(paint.calls, HALL.amberDim)).toBe(true)
  })

  it('paints a merge junction exactly like a split with one out', () => {
    const merge: BeltTile = { x: 17, y: 7, ins: ['W', 'S'], outs: ['N'], kind: 'merge', over: null }
    const split: BeltTile = { ...merge, kind: 'split' }
    const mergePaint = createRecordingPaint()
    drawBelts(mergePaint, baseMap({ beltTiles: [merge] }), { movingBeltIds: new Set(), tMs: 0 })
    const splitPaint = createRecordingPaint()
    drawBelts(splitPaint, baseMap({ beltTiles: [split] }), { movingBeltIds: new Set(), tMs: 0 })
    expect(containsColor(mergePaint.calls, HALL.amber)).toBe(false)
    expect(mergePaint.calls).toEqual(splitPaint.calls)
  })
}

function cornerTilesTests() {
  it('paints a corner as a belt with the small grey hub at its turn, which a straight tile has not', () => {
    const corner: BeltTile = { x: 9, y: 4, ins: ['W'], outs: ['S'], kind: 'corner', over: null }
    const straight: BeltTile = { ...corner, outs: ['E'], kind: 'straight' }
    const cornerPaint = createRecordingPaint()
    drawBelts(cornerPaint, baseMap({ beltTiles: [corner] }), { movingBeltIds: new Set(), tMs: 0 })
    const straightPaint = createRecordingPaint()
    drawBelts(straightPaint, baseMap({ beltTiles: [straight] }), {
      movingBeltIds: new Set(),
      tMs: 0,
    })
    const [x, y] = [corner.x * TILE_PX, corner.y * TILE_PX]
    expect(hasRect(cornerPaint.calls, [x + 6, y + 6, 4, 4], '#20252c')).toBe(true)
    expect(hasRect(cornerPaint.calls, [x + 7, y + 7, 2, 2], HALL.steelDark)).toBe(true)
    expect(hasRect(straightPaint.calls, [x + 6, y + 6, 4, 4], '#20252c')).toBe(false)
    expect(containsColor(cornerPaint.calls, HALL.amberDim)).toBe(true)
  })
}

function wallFixturesTests() {
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
    drawProp(paint, p, { context: context(), tMs: 0 })
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
}

function crossTilesTests() {
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
    drawBelts(paint, map, { movingBeltIds: new Set(), tMs: 0 })
    expect(containsColor(paint.calls, '#20252c')).toBe(true)
  })

  it('paints a crossover over a horizontal belt as a 10x16 HALL.steelDark plate at x+3', () => {
    const tile: BeltTile = { x: 25, y: 6, ins: ['W'], outs: ['E'], kind: 'straight', over: null }
    const map = baseMap({ beltTiles: [tile], crossovers: [{ x: 25, y: 6 }] })
    const paint = createRecordingPaint()
    drawBelts(paint, map, { movingBeltIds: new Set(), tMs: 0 })
    const x = tile.x * TILE_PX
    const y = tile.y * TILE_PX
    expect(hasRect(paint.calls, [x + 3, y, 10, 16], HALL.steelDark)).toBe(true)
  })
}

function rightAngleCrossingTests() {
  it('raises an east-west belt over a north-south one on a 16x12 deck, rimmed above in steel', () => {
    const tile: BeltTile = {
      x: 8,
      y: 9,
      ins: ['N'],
      outs: ['S'],
      kind: 'cross',
      over: { from: 'W', to: 'E' },
    }
    const paint = createRecordingPaint()
    drawBelts(paint, baseMap({ beltTiles: [tile] }), { movingBeltIds: new Set(), tMs: 0 })
    const [x, y] = [tile.x * TILE_PX, tile.y * TILE_PX]
    expect(hasRect(paint.calls, [x, y + 2, 16, 12], '#20252c')).toBe(true)
    expect(hasRect(paint.calls, [x, y + 1, 16, 1], HALL.steelLight)).toBe(true)
    expect(hasRect(paint.calls, [x + 2, y, 12, 16], '#20252c')).toBe(false)
  })

  it('paints a crossover over a vertical belt as a 16x10 HALL.steelDark plate at y+3', () => {
    const tile: BeltTile = { x: 25, y: 6, ins: ['N'], outs: ['S'], kind: 'straight', over: null }
    const map = baseMap({ beltTiles: [tile], crossovers: [{ x: 25, y: 6 }] })
    const paint = createRecordingPaint()
    drawBelts(paint, map, { movingBeltIds: new Set(), tMs: 0 })
    const [x, y] = [tile.x * TILE_PX, tile.y * TILE_PX]
    expect(hasRect(paint.calls, [x, y + 3, 16, 10], HALL.steelDark)).toBe(true)
    expect(hasRect(paint.calls, [x + 3, y, 10, 16], HALL.steelDark)).toBe(false)
    expect(hasRect(paint.calls, [x, y + 2, 2, 1], HALL.amber)).toBe(true)
  })
}

function treadsTests() {
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
    drawBelts(stillA, map, { movingBeltIds: new Set(), tMs: 0 })
    const stillB = createRecordingPaint()
    drawBelts(stillB, map, { movingBeltIds: new Set(), tMs: 500 })
    expect(stillA.calls).toEqual(stillB.calls)

    const movingA = createRecordingPaint()
    drawBelts(movingA, map, { movingBeltIds: new Set(['b1']), tMs: 0 })
    const movingB = createRecordingPaint()
    drawBelts(movingB, map, { movingBeltIds: new Set(['b1']), tMs: 500 })
    expect(movingA.calls).not.toEqual(movingB.calls)
  })
}

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
    drawQueuePlate(paint, exit, { context: context(), tMs: 0 })
    expect(paint.calls).toHaveLength(0)
  })

  it('draws the plate once a queue position is on the scene context', () => {
    const paint = createRecordingPaint()
    drawQueuePlate(paint, exit, { context: context({ queue: { position: 2 } }), tMs: 0 })
    expect(paint.calls.length).toBeGreaterThan(0)
  })

  it('flashes the beacon on the same clock as a waiting gate', () => {
    const t0 = createRecordingPaint()
    drawQueuePlate(t0, exit, { context: context({ queue: { position: 1 } }), tMs: 0 })
    const t1 = createRecordingPaint()
    drawQueuePlate(t1, exit, { context: context({ queue: { position: 1 } }), tMs: 250 })
    expect(t0.calls).not.toEqual(t1.calls)
  })

  it('draws the same plate regardless of position value beyond the digits shown', () => {
    const paint = createRecordingPaint()
    expect(() =>
      drawQueuePlate(paint, exit, { context: context({ queue: { position: 12 } }), tMs: 0 })
    ).not.toThrow()
    expect(paint.calls.length).toBeGreaterThan(0)
  })
})

const SHELL = '#040907'
const PAGE = '#161e2a'
const EDIT = '#1f5566'
const tools = (t: 'rack' | 'archive' | 'desk') => context({ tools: { n1: t } })
const HEAD = '#6b7482'
const headY = (calls: readonly PaintCall[]): number[] =>
  calls.filter((c) => c.op === 'fillRect' && c.style === HEAD).map((c) => (c as { y: number }).y)
const at = 1000
const swing = (pass: boolean) => context({ verdicts: [{ nodeId: 'n1', pass, at }] })
const x = 4 * TILE_PX
const y = 4 * TILE_PX
const lowered = (calls: readonly PaintCall[]) =>
  hasRect(calls, [x + 1, y - 4, TILE_PX - 2, 3], '#e9ecef')
const raised = (calls: readonly PaintCall[]) => hasRect(calls, [x, y - 20, 2, 16], '#e9ecef')
const segments = (calls: readonly PaintCall[]) =>
  calls.filter((c) => c.op === 'fillRect' && c.w === 2 && c.h === 2 && c.style === '#e9ecef')

describe('factory/art/props station work', () => {
  describe('desk screens', () => {
    describe('tool screens', toolScreensTests)
    describe('typists', typistsTests)
  })

  describe('rig', () => {
    describe('the ticker', theTickerTests)
    describe('verdicts', verdictsTests)
    describe('other and newest verdicts', otherAndNewestVerdictsTests)
  })

  describe('press', () => {
    describe('working', workingTests)
    describe('stripes', stripesTests)
  })

  describe('gate arm', () => {
    describe('swinging', swingingTests)
    describe('after the swing', afterTheSwingTests)
  })
  describe('racks and shelves', racksAndShelvesTests)
})

function racksAndShelvesTests() {
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
}

function toolScreensTests() {
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
    expect(containsColor(draw('desk', context({ tools: { other: 'rack' } }), 0), SHELL)).toBe(false)
  })
}

function typistsTests() {
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
      expect(containsColor(draw('desk', context({ crew: [crew({ anim: 'type' })] }), t), KEY)).toBe(
        true
      )
      expect(containsColor(draw('desk', tools('desk'), t), KEY)).toBe(false)
      expect(containsColor(draw('desk', context(), t), KEY)).toBe(false)
    }
  })
}

function theTickerTests() {
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
      hasRect(draw('rig', scanning, 840), [4 * TILE_PX + 14, 4 * TILE_PX + 4, 1, 1], HALL.amber)
    ).toBe(true)
    expect(
      hasRect(draw('rig', context(), 840), [4 * TILE_PX + 14, 4 * TILE_PX + 4, 1, 1], HALL.amber)
    ).toBe(false)
  })
}

function verdictsTests() {
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
}

function otherAndNewestVerdictsTests() {
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
}

function workingTests() {
  const BEACON = '#20242c'

  const SPARK = '#ffd27a'

  it('works while its step is running, with no crew at all', () => {
    const ctx = context({ states: { n1: 'running' } })
    for (const t of STAGES) expect(containsColor(draw('press', ctx, t), BEACON)).toBe(true)
    expect(containsColor(draw('press', ctx, 714), SPARK)).toBe(true)
    expect(containsColor(draw('press', ctx, 0), SPARK)).toBe(false)
    expect(headY(draw('press', ctx, 0))).not.toEqual(headY(draw('press', ctx, 714)))
  })

  it.each(['waiting', 'passed', 'failed', 'blocked'] as const)(
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
}

function stripesTests() {
  it('crawls the guard-rail stripes only while working', () => {
    const work = context({ states: { n1: 'running' } })
    const stripe = (ctx: SceneContext, t: number) =>
      hasRect(draw('press', ctx, t), [4 * TILE_PX + 2, 3 * TILE_PX + 4 + 6, 4, 3], HALL.amber)
    // Stripe row 1 is amber once the crawl has moved it by six.
    expect(stripe(work, 0)).toBe(false)
    expect(stripe(work, 720)).toBe(true)
    expect(stripe(context(), 720)).toBe(false)
  })
}

function swingingTests() {
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
}

function afterTheSwingTests() {
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
}
