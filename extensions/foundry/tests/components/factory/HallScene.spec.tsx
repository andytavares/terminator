import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { HallScene } from '../../../src/components/factory/HallScene.js'
import type { HallMap } from '../../../src/factory/layout.js'
import type { World } from '../../../src/factory/sim.js'

// jsdom has no canvas at all, so every 2D context here is a fake this spec
// records calls on. The point of these tests is the render loop's lifecycle
// — one rAF started, cancelled on unmount, none scheduled under reduced
// motion — not pixel output, which the art specs already cover through
// `Paint`.

function fakeMap(): HallMap {
  const width = 6
  const height = 6
  const solid = Array.from({ length: height }, () => Array(width).fill(false))
  return {
    width,
    height,
    solid,
    props: [],
    belts: [],
    lanes: [],
    anchors: {
      intake: { x: 0, y: 3 },
      exit: { x: width - 1, y: 3 },
      archive: { x: 1, y: 2 },
      rack: { x: 2, y: 2 },
      wait: { x: 3, y: 2 },
      lounge: [{ x: 1, y: 4 }],
    },
    lights: [{ x: 3, y: 3 }],
  }
}

function fakeWorld(map: HallMap): World {
  return { map, crew: [], crates: [], gatesWaiting: [], openCalls: [], clockMs: 0 }
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
})
