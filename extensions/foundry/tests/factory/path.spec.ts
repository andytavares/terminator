import { describe, it, expect } from 'vitest'
import { findPath, distancesFrom } from '../../src/factory/path.js'

// A 4-neighbour path over a tile grid: `solid[y][x]` blocks movement, except
// that the destination itself is always a legal place to arrive even when it
// is solid — a crew member walks up to a desk, not into it.

function grid(rows: string[]): boolean[][] {
  return rows.map((row) => row.split('').map((ch) => ch === '#'))
}

describe('findPath', () => {
  it('walks a straight line when nothing is in the way', () => {
    const solid = grid(['.....', '.....', '.....'])
    const path = findPath(solid, { x: 0, y: 1 }, { x: 3, y: 1 })
    expect(path).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ])
  })

  it('detours around a wall', () => {
    const solid = grid(['.....', '.###.', '.....'])
    const path = findPath(solid, { x: 0, y: 1 }, { x: 4, y: 1 })
    expect(path.length).toBeGreaterThan(0)
    expect(path[path.length - 1]).toEqual({ x: 4, y: 1 })
    for (const tile of path.slice(0, -1)) {
      expect(solid[tile.y][tile.x]).toBe(false)
    }
    // every step is orthogonally adjacent to the one before it
    let prev = { x: 0, y: 1 }
    for (const tile of path) {
      const dist = Math.abs(tile.x - prev.x) + Math.abs(tile.y - prev.y)
      expect(dist).toBe(1)
      prev = tile
    }
  })

  it('returns [] when the target is unreachable', () => {
    const solid = grid(['.....', '#####', '.....'])
    const path = findPath(solid, { x: 0, y: 0 }, { x: 0, y: 2 })
    expect(path).toEqual([])
  })

  it('returns [] when from equals to', () => {
    const solid = grid(['.....'])
    const path = findPath(solid, { x: 2, y: 0 }, { x: 2, y: 0 })
    expect(path).toEqual([])
  })

  it('allows a solid destination — a crew member can walk up to a station', () => {
    const solid = grid(['...', '..#'])
    const path = findPath(solid, { x: 0, y: 0 }, { x: 2, y: 1 })
    expect(path[path.length - 1]).toEqual({ x: 2, y: 1 })
    expect(path.length).toBeGreaterThan(0)
  })
})

describe('distancesFrom', () => {
  it('gives the origin distance 0 and its neighbours increasing distances', () => {
    const solid = grid(['.....', '.....', '.....'])
    const d = distancesFrom(solid, { x: 2, y: 1 })
    expect(d.get('2,1')).toBe(0)
    expect(d.get('1,1')).toBe(1)
    expect(d.get('3,1')).toBe(1)
    expect(d.get('2,0')).toBe(1)
    expect(d.get('2,2')).toBe(1)
    expect(d.get('0,1')).toBe(2)
  })

  it('detours around a wall instead of counting straight-line distance', () => {
    const solid = grid(['.....', '.###.', '.....'])
    const d = distancesFrom(solid, { x: 0, y: 1 })
    // straight-line distance to (4,1) is 4, but the wall forces a detour
    // up-and-over (or down-and-under).
    expect(d.get('4,1')).toBe(6)
  })

  it('omits a tile the flood never reaches', () => {
    const solid = grid(['.....', '#####', '.....'])
    const d = distancesFrom(solid, { x: 0, y: 0 })
    expect(d.has('0,2')).toBe(false)
    expect(d.get('0,0')).toBe(0)
  })
})
