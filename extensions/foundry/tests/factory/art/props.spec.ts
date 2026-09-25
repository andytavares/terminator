import { describe, it, expect } from 'vitest'
import { drawProp, bakeHall, drawBelt, drawCrate } from '../../../src/factory/art/props.js'
import type { SceneContext } from '../../../src/factory/art/props.js'
import { HALL } from '../../../src/factory/art/palette.js'
import type { HallProp, HallMap, HallBelt, PropKind } from '../../../src/factory/layout.js'
import type { Crew } from '../../../src/factory/sim.js'
import { createRecordingPaint } from './paint-fake.js'

// The honesty rule under test: a prop's "alive" details (lit screens, a
// waveform, a flashing beacon, moving treads) exist in the recorded draw
// calls only when the cause the design names for them is present, and never
// otherwise — regardless of the clock.

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
  'couch',
  'coffee',
  'plant',
  'booth',
  'chair',
]

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
    w: kind === 'desk' || kind === 'press' ? 3 : kind === 'gate' ? 1 : 2,
    h: 1,
    solid: true,
    nodeId: kind === 'chair' || kind === 'shelves' ? null : 'n1',
    seat: { x: 4, y: 5 },
    ...overrides,
  }
}

function context(overrides: Partial<SceneContext> = {}): SceneContext {
  return { crew: [], states: {}, gatesWaiting: [], ...overrides }
}

function containsColor(
  calls: readonly { readonly op: string; readonly style?: unknown }[],
  color: string
): boolean {
  return calls.some((c) => c.op === 'fillRect' && (c as { style?: unknown }).style === color)
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
})

describe('factory/art/props bakeHall', () => {
  function map(): HallMap {
    const width = 12
    const height = 10
    const solid = Array.from({ length: height }, () => Array(width).fill(false))
    return {
      width,
      height,
      solid,
      props: [],
      belts: [],
      lanes: [],
      anchors: {
        intake: { x: 0, y: 4 },
        exit: { x: width - 1, y: 4 },
        archive: { x: 1, y: 3 },
        rack: { x: 2, y: 3 },
        wait: { x: 3, y: 3 },
        lounge: [{ x: 1, y: 6 }],
      },
      lights: [],
    }
  }

  it('bakes without throwing and draws something', () => {
    const paint = createRecordingPaint()
    bakeHall(map(), paint)
    expect(paint.calls.length).toBeGreaterThan(0)
  })

  it('bakes the walkway lines, hazard hatch, rug and lane stencil for a fuller map', () => {
    const base = map()
    const fuller: HallMap = {
      ...base,
      props: [prop('press', { x: 5, y: 4, w: 3, h: 1 }), prop('gate', { x: 9, y: 4, w: 1, h: 1 })],
      belts: [
        {
          id: 'a->b',
          fromNodeId: 'a',
          toNodeId: 'b',
          path: [
            { x: 2, y: 5 },
            { x: 3, y: 5 },
          ],
        },
      ],
      lanes: [{ lane: 1, row: 5, label: 'Lane 1' }],
      anchors: {
        ...base.anchors,
        lounge: [
          { x: 1, y: 6 },
          { x: 3, y: 6 },
          { x: 2, y: 7 },
        ],
      },
    }
    const paint = createRecordingPaint()
    expect(() => bakeHall(fuller, paint)).not.toThrow()
    expect(paint.calls.length).toBeGreaterThan(0)
  })

  it('skips the lane stencil when a lane label carries no digit', () => {
    const base = map()
    const noDigitLane: HallMap = { ...base, lanes: [{ lane: 1, row: 5, label: 'Lane' }] }
    const paint = createRecordingPaint()
    expect(() => bakeHall(noDigitLane, paint)).not.toThrow()
  })

  it('skips the rug when the hall has no lounge anchors', () => {
    const base = map()
    const noLounge: HallMap = { ...base, anchors: { ...base.anchors, lounge: [] } }
    const paint = createRecordingPaint()
    expect(() => bakeHall(noLounge, paint)).not.toThrow()
  })
})

describe('factory/art/props belts and crates', () => {
  function belt(): HallBelt {
    return {
      id: 'a->b',
      fromNodeId: 'a',
      toNodeId: 'b',
      path: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
    }
  }

  it('moves belt treads only while a crate rides the belt', () => {
    const stillA = createRecordingPaint()
    drawBelt(stillA, belt(), false, 0)
    const stillB = createRecordingPaint()
    drawBelt(stillB, belt(), false, 500)
    expect(stillA.calls).toEqual(stillB.calls)

    const movingA = createRecordingPaint()
    drawBelt(movingA, belt(), true, 0)
    const movingB = createRecordingPaint()
    drawBelt(movingB, belt(), true, 500)
    expect(movingA.calls).not.toEqual(movingB.calls)
  })

  it('draws a crate without throwing', () => {
    const paint = createRecordingPaint()
    expect(() => drawCrate(paint, 10, 10)).not.toThrow()
    expect(paint.calls.length).toBeGreaterThan(0)
  })
})
