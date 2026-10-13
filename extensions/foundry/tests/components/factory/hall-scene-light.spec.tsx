import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { HallScene } from '../../../src/components/factory/HallScene.js'
import type { HallMap, HallProp } from '../../../src/factory/layout.js'
import type { Crew, World } from '../../../src/factory/sim.js'
import { partialFake } from '../../../../../tests/support/fakes'

// What HallScene.spec.tsx leaves out: the light a working station gives off —
// a hot press, a crew member scanning at the rack — and a loop that stops
// while the page is hidden and picks up again when it is shown.

const PRESS: HallProp = {
  id: 'press-1',
  kind: 'press',
  x: 2,
  y: 2,
  w: 2,
  h: 2,
  solid: true,
  nodeId: 'N-1',
  seat: null,
  sign: null,
}

function map(props: HallProp[] = []): HallMap {
  const solid = Array.from({ length: 6 }, () => Array(6).fill(false))
  return {
    width: 6,
    height: 6,
    solid,
    walk: solid.map((row) => [...row]),
    props,
    belts: [],
    beltTiles: [],
    crossovers: [],
    breakroom: { x: 1, y: 4, w: 3, h: 1, door: [] },
    restSeats: [],
    lanes: [],
    anchors: {
      intake: { x: 0, y: 3 },
      exit: { x: 5, y: 3 },
      archive: { x: 1, y: 2 },
      rack: { x: 2, y: 2 },
      wait: { x: 3, y: 2 },
    },
    lights: [],
  }
}

function world(on: HallMap, crew: Crew[] = []): World {
  return { map: on, crew, crates: [], gatesWaiting: [], openCalls: [], verdicts: [], clockMs: 0 }
}

const scanning: Crew = {
  nodeId: 'N-1',
  role: null,
  x: 40,
  y: 44,
  facing: 'S',
  anim: 'scan',
  path: [],
  goal: null,
  then: 'idle',
  present: true,
  restSeat: null,
  settle: null,
}

/** Every colour a gradient was given, across every canvas. */
let stops: string[] = []

/** A 2D context that accepts any call, and keeps the colours of its gradients. */
function anyContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: (_at: number, colour: string) => stops.push(colour) }
  const fields: Record<string, unknown> = {}
  const context = new Proxy<Partial<CanvasRenderingContext2D>>(
    {},
    {
      get: (_t, key: string) =>
        key in fields ? fields[key] : key.startsWith('create') ? () => gradient : () => undefined,
      set: (_t, key: string, value) => {
        fields[key] = value
        return true
      },
    }
  )
  return partialFake<CanvasRenderingContext2D>(context)
}

beforeEach(() => {
  stops = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(anyContext)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function drawOnce(on: HallMap, states: Record<string, 'running' | 'passed'>, crew: Crew[] = []) {
  render(
    <HallScene map={on} worldRef={{ current: world(on, crew) }} states={states} reducedMotion />
  )
}

describe('the light a working station gives off', () => {
  it('glows over a press whose step is running, and not once it has passed', () => {
    drawOnce(map([PRESS]), { 'N-1': 'running' })
    expect(stops).toContain('rgba(230,160,60,.35)')
    cleanup()
    stops = []
    drawOnce(map([PRESS]), { 'N-1': 'passed' })
    expect(stops).not.toContain('rgba(230,160,60,.35)')
  })

  it('glows over a crew member scanning, and not over one who has gone', () => {
    drawOnce(map(), {}, [scanning])
    expect(stops).toContain('rgba(140,230,120,.3)')
    cleanup()
    stops = []
    drawOnce(map(), {}, [{ ...scanning, present: false }])
    expect(stops).not.toContain('rgba(140,230,120,.3)')
  })
})

describe('a hidden page', () => {
  function setHidden(hidden: boolean): void {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  it('stops the frame loop, and starts it again once the page is shown', () => {
    let next = 1
    const raf = vi.fn(() => next++)
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const on = map()
    render(<HallScene map={on} worldRef={{ current: world(on) }} states={{}} />)
    expect(raf).toHaveBeenCalledTimes(1)
    setHidden(true)
    expect(cancel).toHaveBeenCalledWith(1)
    setHidden(true)
    expect(raf).toHaveBeenCalledTimes(1)
    setHidden(false)
    expect(raf).toHaveBeenCalledTimes(2)
    setHidden(false)
    expect(raf).toHaveBeenCalledTimes(2)
    Reflect.deleteProperty(document, 'hidden')
  })
})
