import { describe, it, expect } from 'vitest'
import { drawMonitorCase, monitorTube } from '../../../src/factory/art/monitor.js'
import { HALL } from '../../../src/factory/art/palette.js'
import { createRecordingPaint } from './paint-fake.js'

const SIZES: readonly [number, number][] = [
  [72, 64],
  [130, 110],
  [40, 44],
]

function record(w: number, h: number) {
  const paint = createRecordingPaint()
  drawMonitorCase(paint, w, h)
  return paint.calls.flatMap((c) => (c.op === 'fillRect' ? [c] : []))
}

// Replays the recorded fills in order so a spec can read the pixel a viewer
// sees, not merely which fill happened.
function raster(w: number, h: number): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: h }, () =>
    Array.from({ length: w }, () => null)
  )
  for (const c of record(w, h)) {
    for (let y = c.y; y < c.y + c.h; y++) {
      for (let x = c.x; x < c.x + c.w; x++) {
        if (grid[y]?.[x] !== undefined) grid[y][x] = c.style as string
      }
    }
  }
  return grid
}

describe('factory/art/monitor drawMonitorCase', () => {
  it.each(SIZES)('paints outline, highlight, shadow and recess at %ix%i', (w, h) => {
    const styles = new Set(record(w, h).map((c) => c.style))
    for (const colour of [
      HALL.caseLine,
      HALL.caseFace,
      HALL.caseHi,
      HALL.caseLo,
      HALL.caseDeep,
      HALL.caseRecess,
      HALL.caseRecessDeep,
      HALL.caseStand,
      HALL.caseTube,
    ]) {
      expect(styles.has(colour)).toBe(true)
    }
  })

  it.each(SIZES)('highlights the top-left and shadows the bottom-right at %ix%i', (w, h) => {
    const g = raster(w, h)
    expect(g[1][w >> 1]).toBe(HALL.caseHi)
    expect(g[h >> 1][1]).toBe(HALL.caseHi)
    expect(g[h - 4][w >> 1]).toBe(HALL.caseLo)
    expect(g[h >> 1][w - 2]).toBe(HALL.caseLo)
  })

  it.each(SIZES)('outlines the corners and leaves the stand foot at %ix%i', (w, h) => {
    const g = raster(w, h)
    expect(g[0][0]).toBeNull()
    expect(g[0][w >> 1]).toBe(HALL.caseLine)
    expect(g[h - 1][w >> 1]).toBe(HALL.caseLine)
    expect(g[h - 3][w >> 1]).toBe(HALL.caseStand)
  })

  it.each(SIZES)('shows only the tube colour inside the tube at %ix%i', (w, h) => {
    const g = raster(w, h)
    const t = monitorTube(w, h)
    for (let y = t.y + 2; y < t.y + t.h - 2; y++) {
      for (let x = t.x + 2; x < t.x + t.w - 2; x++) {
        expect(g[y][x]).toBe(HALL.caseTube)
      }
    }
  })

  it.each(SIZES)('never paints the tube colour outside the tube at %ix%i', (w, h) => {
    const g = raster(w, h)
    const t = monitorTube(w, h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inside = x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h
        if (!inside) expect(g[y][x]).not.toBe(HALL.caseTube)
      }
    }
  })

  it.each(SIZES)('records the same calls for the same size at %ix%i', (w, h) => {
    expect(record(w, h)).toEqual(record(w, h))
  })

  it('draws differently for different sizes', () => {
    expect(record(72, 64)).not.toEqual(record(130, 110))
  })
})

describe('factory/art/monitor monitorTube', () => {
  it('insets the tube from the case', () => {
    expect(monitorTube(72, 64)).toEqual({ x: 6, y: 6, w: 60, h: 37 })
    expect(monitorTube(130, 110)).toEqual({ x: 6, y: 6, w: 118, h: 83 })
  })

  it('matches the recess painted around it', () => {
    const w = 72
    const h = 64
    const t = monitorTube(w, h)
    const recess = record(w, h).find(
      (c) => c.style === HALL.caseDeep && c.x === t.x - 1 && c.y === t.y - 1
    )
    expect(recess).toMatchObject({ w: t.w + 2, h: t.h + 2 })
  })
})
