import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { HallScene, sceneActivity, drawOrderY } from '../../../src/components/factory/HallScene.js'
import type { HallMap, HallProp } from '../../../src/factory/layout.js'
import type { Crew, World } from '../../../src/factory/sim.js'

// jsdom has no canvas at all, so every 2D context here is a fake this spec
// records calls on. The point of these tests is the render loop's lifecycle
// — one rAF started, cancelled on unmount, none scheduled under reduced
// motion — not pixel output, which the art specs already cover through
// `Paint`.

function fakeMap(): HallMap {
  const width = 6
  const height = 6
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
    breakroom: { x: 1, y: 4, w: 3, h: 1, door: [] },
    restSeats: [],
    lanes: [],
    anchors: {
      intake: { x: 0, y: 3 },
      exit: { x: width - 1, y: 3 },
      archive: { x: 1, y: 2 },
      rack: { x: 2, y: 2 },
      wait: { x: 3, y: 2 },
    },
    lights: [{ x: 3, y: 3 }],
  }
}

function fakeWorld(map: HallMap): World {
  return { map, crew: [], crates: [], gatesWaiting: [], openCalls: [], verdicts: [], clockMs: 0 }
}

function fakeContext2D(fillRectSpy: ReturnType<typeof vi.fn>) {
  return {
    fillStyle: '#000',
    globalCompositeOperation: 'source-over',
    fillRect: fillRectSpy,
    drawImage: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  }
}

describe('components/factory/HallScene', () => {
  let fillRectSpy: ReturnType<typeof vi.fn>
  let rafSpy: ReturnType<typeof vi.fn>
  let cancelSpy: ReturnType<typeof vi.fn>
  let nextRafId: number

  beforeEach(() => {
    fillRectSpy = vi.fn()
    nextRafId = 1
    rafSpy = vi.fn(() => nextRafId++)
    cancelSpy = vi.fn()
    vi.stubGlobal('requestAnimationFrame', rafSpy)
    vi.stubGlobal('cancelAnimationFrame', cancelSpy)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => fakeContext2D(fillRectSpy) as unknown as RenderingContext
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('starts one rAF loop on mount and cancels it on unmount', () => {
    const map = fakeMap()
    const worldRef = { current: fakeWorld(map) }
    const { unmount } = render(<HallScene map={map} worldRef={worldRef} states={{}} />)

    expect(rafSpy).toHaveBeenCalledTimes(1)
    const scheduledId = rafSpy.mock.results[0]?.value as number

    unmount()

    expect(cancelSpy).toHaveBeenCalledWith(scheduledId)
  })

  it('draws the bake and the frame at least once on mount', () => {
    const map = fakeMap()
    const worldRef = { current: fakeWorld(map) }
    render(<HallScene map={map} worldRef={worldRef} states={{}} />)

    expect(fillRectSpy).toHaveBeenCalled()
  })

  it('draws exactly one frame and schedules nothing under reduced motion', () => {
    const map = fakeMap()
    const worldRef = { current: fakeWorld(map) }
    render(<HallScene map={map} worldRef={worldRef} states={{}} reducedMotion />)

    expect(rafSpy).not.toHaveBeenCalled()
    expect(fillRectSpy).toHaveBeenCalled()
  })

  it('is aria-hidden and sized to the map in tiles', () => {
    const map = fakeMap()
    const worldRef = { current: fakeWorld(map) }
    const { container } = render(
      <HallScene map={map} worldRef={worldRef} states={{}} reducedMotion />
    )
    const canvas = container.querySelector('canvas')
    expect(canvas?.getAttribute('aria-hidden')).toBe('true')
    expect(canvas?.width).toBe(map.width * 16)
    expect(canvas?.height).toBe(map.height * 16)
  })

  describe('drawOrderY', () => {
    const roomRow = 19
    const room: HallProp = {
      id: 'room-partition',
      kind: 'partition',
      x: 7,
      y: roomRow,
      w: 15,
      h: 5,
      solid: false,
      nodeId: null,
      seat: null,
      sign: null,
    }
    const standingOn = (row: number): number => row * 16 + 12

    it('sorts the breakroom partition by its wall row, so crew on the room first row draw over it', () => {
      expect(drawOrderY(room)).toBeLessThan(standingOn(roomRow + 1))
      expect(drawOrderY(room)).toBeGreaterThan(standingOn(roomRow - 1))
    })

    it('sorts other props by their floor edge, and seating furniture by its top', () => {
      expect(drawOrderY({ ...room, kind: 'desk', y: 5, h: 2 })).toBe(7 * 16)
      expect(drawOrderY({ ...room, kind: 'sofa', y: 5, h: 2 })).toBe(5 * 16)
    })
  })

  describe('sceneActivity', () => {
    const standAt = (tile: { x: number; y: number }, over: Partial<Crew> = {}): Crew => ({
      nodeId: 'N-1',
      role: null,
      x: tile.x * 16 + 8,
      y: tile.y * 16 + 12,
      facing: 'down',
      anim: 'reach',
      path: [],
      goal: null,
      then: 'idle',
      present: true,
      restSeat: null,
      settle: null,
      ...over,
    })

    it('keeps the newest open tool per station and passes the verdicts through', () => {
      const map = fakeMap()
      const verdicts = [{ nodeId: 'N-2', pass: false, at: 40 }]
      const world: World = {
        ...fakeWorld(map),
        verdicts,
        openCalls: [
          { nodeId: 'N-1', prop: 'archive', callId: 'a', at: 10 },
          { nodeId: 'N-1', prop: 'rack', callId: 'b', at: 30 },
          { nodeId: 'N-1', prop: 'desk', callId: 'c', at: 20 },
          { nodeId: 'N-2', prop: 'archive', callId: 'd', at: 5 },
        ],
      }
      const activity = sceneActivity(world)
      expect(activity.tools).toEqual({ 'N-1': 'rack', 'N-2': 'archive' })
      expect(activity.verdicts).toBe(verdicts)
    })

    it('reports a fixture only for a present crew member reaching at it', () => {
      const map = fakeMap()
      const { archive, rack } = map.anchors
      const crew = [
        standAt(archive),
        standAt(rack, { present: false }),
        standAt(rack, { goal: { x: 2, y: 2 } }),
        standAt({ x: 4, y: 4 }),
        standAt(rack, { anim: 'type' }),
      ]
      expect(sceneActivity({ ...fakeWorld(map), crew }).reaching).toEqual(['archive'])
      expect(sceneActivity({ ...fakeWorld(map), crew: [standAt(rack)] }).reaching).toEqual(['rack'])
    })
  })
})
