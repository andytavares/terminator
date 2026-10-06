import { describe, it, expect } from 'vitest'
import {
  drawProp,
  drawQueuePlate,
  bakeHall,
  vendingDecorX,
} from '../../../src/factory/art/props.js'
import type { SceneContext } from '../../../src/factory/art/props.js'
import { boardRect, plateRect, towerRect } from '../../../src/factory/art/fixtures.js'
import type { Rect } from '../../../src/factory/art/fixtures.js'
import { GLYPHS } from '../../../src/factory/art/glyphs.js'
import { HALL } from '../../../src/factory/art/palette.js'
import { TILE_PX } from '../../../src/factory/layout.js'
import type { HallMap, HallProp } from '../../../src/factory/layout.js'
import type { Check } from '../../../src/line/ci.js'
import { createRecordingPaint } from './paint-fake.js'
import type { PaintCall } from './paint-fake.js'

// Every sign the hall draws is read, so every sign has to stay on its own
// fixture: a digit that spills past its board lands on the wall beside it.

function fixture(kind: HallProp['kind'], over: Partial<HallProp> = {}): HallProp {
  return {
    id: kind,
    kind,
    x: 10,
    y: 6,
    w: 1,
    h: 1,
    solid: false,
    nodeId: kind === 'dispatch' ? 'ci' : null,
    seat: null,
    sign: null,
    ...over,
  }
}

function context(over: Partial<SceneContext> = {}): SceneContext {
  return { crew: [], states: {}, gatesWaiting: [], ...over }
}

type Fill = Extract<PaintCall, { op: 'fillRect' }>
const fills = (calls: readonly PaintCall[]): Fill[] =>
  calls.filter((c): c is Fill => c.op === 'fillRect')

function outside(calls: readonly PaintCall[], rect: Rect): Fill[] {
  return fills(calls).filter(
    (c) => c.x < rect.left || c.y < rect.top || c.x + c.w > rect.right || c.y + c.h > rect.bottom
  )
}

function checks(pass: number, pending: number, fail: number): Record<string, Check['bucket']> {
  const all: Record<string, Check['bucket']> = {}
  for (let i = 0; i < pass; i++) all[`pass-${i}`] = 'pass'
  for (let i = 0; i < pending; i++) all[`pending-${i}`] = 'pending'
  for (let i = 0; i < fail; i++) all[`fail-${i}`] = 'fail'
  return all
}

const setBits = (digits: string): number =>
  [...digits].reduce((n, d) => n + [...GLYPHS[d]].filter((b) => b === '1').length, 0)

describe('the scoreboard', () => {
  const board = fixture('statuswall', { x: 20, y: 2, w: 3 })

  it.each([
    ['a fresh order', { leadTimeMs: 25 * 60_000, reworks: 0, ciRounds: 0 }],
    ['the widest figures', { leadTimeMs: 99 * 60_000, reworks: 99, ciRounds: 99 }],
    ['a figure past two digits', { leadTimeMs: 4000 * 60_000, reworks: 500, ciRounds: 120 }],
    ['an order that has not shipped', { leadTimeMs: null, reworks: 3, ciRounds: 1 }],
  ])('keeps every pixel inside its three tiles for %s', (_name, metrics) => {
    const paint = createRecordingPaint()
    drawProp(paint, board, context({ metrics }), 0)
    expect(fills(paint.calls).length).toBeGreaterThan(0)
    expect(outside(paint.calls, boardRect(board))).toEqual([])
  })

  it('is three tiles wide and one cell per figure, each under its own icon colour', () => {
    const paint = createRecordingPaint()
    drawProp(
      paint,
      board,
      context({ metrics: { leadTimeMs: 25 * 60_000, reworks: 2, ciRounds: 3 } }),
      0
    )
    const rect = boardRect(board)
    expect(rect.right - rect.left).toBe(3 * TILE_PX)
    const cell = (rect.right - rect.left) / 3
    for (const [index, color] of [HALL.cyan, HALL.red, HALL.amber].entries()) {
      const mine = fills(paint.calls).filter((c) => c.style === color)
      expect(mine.length).toBeGreaterThan(0)
      for (const c of mine) {
        expect(c.x).toBeGreaterThanOrEqual(rect.left + index * cell)
        expect(c.x + c.w).toBeLessThanOrEqual(rect.left + (index + 1) * cell)
      }
    }
  })

  it("draws no progress bar: that is the heads-up display's job", () => {
    const paint = createRecordingPaint()
    drawProp(
      paint,
      board,
      context({
        states: { a: 'passed', b: 'waiting' },
        metrics: { leadTimeMs: 0, reworks: 0, ciRounds: 0 },
      }),
      0
    )
    expect(fills(paint.calls).some((c) => c.style === HALL.green)).toBe(false)
  })
})

describe('the queue plate', () => {
  const exit = { x: 30, y: 8 }

  it.each([1, 12, 99, 100])('keeps position %i inside the plate, on whole pixels', (position) => {
    for (const tMs of [0, 250]) {
      const paint = createRecordingPaint()
      drawQueuePlate(paint, exit, context({ queue: { position } }), tMs)
      const all = fills(paint.calls)
      expect(all.length).toBeGreaterThan(0)
      expect(outside(paint.calls, plateRect(exit))).toEqual([])
      for (const c of all) {
        for (const n of [c.x, c.y, c.w, c.h]) expect(Number.isInteger(n)).toBe(true)
      }
    }
  })

  it('is sixteen pixels tall and draws its digit one pixel at a time', () => {
    const rect = plateRect(exit)
    expect(rect.bottom - rect.top).toBe(16)
    const paint = createRecordingPaint()
    drawQueuePlate(paint, exit, context({ queue: { position: 1 } }), 0)
    const ink = fills(paint.calls).filter((c) => c.style === '#1a1508')
    expect(ink.length).toBe(setBits('1'))
    expect(ink.every((c) => c.w === 1 && c.h === 1)).toBe(true)
  })

  it('draws nothing out of a queue', () => {
    const paint = createRecordingPaint()
    drawQueuePlate(paint, exit, context(), 0)
    expect(paint.calls).toEqual([])
  })
})

describe('the CI tower', () => {
  const tower = fixture('dispatch', { x: 38, y: 8 })
  const lamps = (calls: readonly PaintCall[]): Fill[] =>
    fills(calls).filter(
      (c) =>
        c.w === 3 && c.h === 3 && [HALL.green, HALL.amber, HALL.red].includes(c.style as string)
    )

  it.each([
    [0, 0, 0],
    [1, 0, 0],
    [12, 5, 2],
    [100, 50, 50],
    [0, 200, 0],
  ])(
    'keeps %i passed, %i pending and %i failed inside the tower (and the parked crate)',
    (p, w, f) => {
      const exitTile = {
        left: (tower.x + 1) * TILE_PX,
        top: tower.y * TILE_PX,
        right: (tower.x + 2) * TILE_PX,
        bottom: (tower.y + 1) * TILE_PX + 2,
      }
      const paint = createRecordingPaint()
      drawProp(paint, tower, context({ ci: { checks: checks(p, w, f) } }), 0)
      const strays = outside(paint.calls, towerRect(tower)).filter(
        (c) =>
          c.x < exitTile.left ||
          c.y < exitTile.top ||
          c.x + c.w > exitTile.right ||
          c.y + c.h > exitTile.bottom
      )
      expect(strays).toEqual([])
    }
  )

  it('shows three lamps however many checks there are, each with its count in one-pixel digits', () => {
    const paint = createRecordingPaint()
    drawProp(paint, tower, context({ ci: { checks: checks(12, 5, 2) } }), 0)
    expect(
      lamps(paint.calls)
        .map((c) => c.style)
        .sort()
    ).toEqual([HALL.amber, HALL.green, HALL.red].sort())
    const digits = fills(paint.calls).filter((c) => c.style === '#e9ecef' && c.w === 1 && c.h === 1)
    expect(digits.length).toBe(setBits('12') + setBits('5') + setBits('2'))
  })

  it('lights a lamp only for a bucket that has checks in it', () => {
    const paint = createRecordingPaint()
    drawProp(paint, tower, context({ ci: { checks: checks(3, 0, 0) } }), 0)
    expect(lamps(paint.calls).map((c) => c.style)).toEqual([HALL.green])
  })

  it('blinks an amber beacon and parks a crate at the exit only while a check is pending', () => {
    const crate = '#b07a3c'
    const beacon = (calls: readonly PaintCall[], color: string): boolean =>
      fills(calls).some(
        (c) => c.w === 6 && c.h === 3 && c.style === color && c.y < tower.y * TILE_PX - 24
      )

    const on = createRecordingPaint()
    drawProp(on, tower, context({ ci: { checks: checks(1, 1, 0) } }), 0)
    expect(beacon(on.calls, HALL.amber)).toBe(true)
    expect(fills(on.calls).some((c) => c.style === crate)).toBe(true)

    const off = createRecordingPaint()
    drawProp(off, tower, context({ ci: { checks: checks(1, 1, 0) } }), 400)
    expect(beacon(off.calls, HALL.amber)).toBe(false)
    expect(beacon(off.calls, HALL.amberDim)).toBe(true)

    const steady = createRecordingPaint()
    drawProp(steady, tower, context({ steady: true, ci: { checks: checks(1, 1, 0) } }), 400)
    expect(beacon(steady.calls, HALL.amber)).toBe(true)

    const quiet = createRecordingPaint()
    drawProp(quiet, tower, context({ ci: { checks: checks(2, 0, 0) } }), 0)
    expect(beacon(quiet.calls, HALL.amber)).toBe(false)
    expect(beacon(quiet.calls, HALL.amberDim)).toBe(false)
    expect(fills(quiet.calls).some((c) => c.style === crate)).toBe(false)
  })
})

describe('the vending decor', () => {
  it('stands clear of every wall fixture', () => {
    const fixtures: HallProp[] = [
      fixture('shelves', { id: 'a', x: 8, y: 2 }),
      fixture('racks', { id: 'b', x: 14, y: 2 }),
      fixture('statuswall', { id: 'c', x: 19, y: 2, w: 3 }),
      fixture('lockers', { id: 'd', x: 28, y: 2 }),
    ]
    const x = vendingDecorX({ width: 40, props: fixtures } as unknown as HallMap)
    for (const f of fixtures) {
      const left = f.x * TILE_PX
      const right = (f.x + f.w) * TILE_PX
      expect(x + 14 <= left || x >= right).toBe(true)
    }
  })

  it('bakes into a hall without throwing', () => {
    const width = 40
    const height = 30
    const grid = Array.from({ length: height }, () => Array(width).fill(false))
    const map = {
      width,
      height,
      solid: grid,
      walk: grid,
      props: [fixture('statuswall', { x: 24, y: 2, w: 3 })],
      belts: [],
      beltTiles: [],
      crossovers: [],
      breakroom: { x: 7, y: 20, w: 20, h: 5, door: [] },
      restSeats: [],
      lanes: [],
      anchors: {
        intake: { x: 0, y: 5 },
        exit: { x: 39, y: 5 },
        archive: { x: 3, y: 3 },
        rack: { x: 4, y: 3 },
        wait: { x: 5, y: 5 },
      },
      lights: [],
    } as unknown as HallMap
    expect(() => bakeHall(map, createRecordingPaint())).not.toThrow()
  })
})

describe('the ship gate while its step runs through the final check and CI', () => {
  const gate = fixture('gate', { id: 'station-ship', nodeId: 'ship', x: 12, y: 6 })
  const beacon = (
    state: SceneContext['states'][string] | undefined,
    over: Partial<SceneContext> = {}
  ) => {
    const paint = createRecordingPaint()
    drawProp(
      paint,
      gate,
      context({ states: state === undefined ? {} : { ship: state }, ...over }),
      0
    )
    return fills(paint.calls).find((c) => c.y === 6 * TILE_PX - 30 && c.h === 5)?.style
  }

  it('burns a steady cyan beacon, neither idle grey nor the open green', () => {
    expect(beacon('running')).toBe(HALL.cyan)
    expect(beacon('verifying')).toBe(HALL.cyan)
    expect(beacon('waiting')).toBe('#3a414b')
    expect(beacon('passed')).toBe(HALL.green)
  })

  it('still flashes amber when it is waiting on you, even while running', () => {
    expect(beacon('running', { gatesWaiting: ['ship'] })).toBe(HALL.amber)
  })
})
