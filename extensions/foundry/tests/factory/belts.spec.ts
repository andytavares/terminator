import { describe, it, expect } from 'vitest'
import { routeBelts } from '../../src/factory/belts.js'
import type { HallProp } from '../../src/factory/layout.js'
import type { RunNode } from '../../src/line/run-graph.js'

// routeBelts in isolation, on small hand-built floors — layout.spec.ts's
// golden fixtures and property sweep already exercise it through a full
// hall; these pin the classification rules and the fallback directly.

function node(over: Partial<RunNode> & Pick<RunNode, 'id'>): RunNode {
  return {
    stepId: over.id,
    kind: 'agent',
    state: 'waiting',
    unitIds: [],
    lane: null,
    role: null,
    dependsOn: [],
    attempts: 0,
    sessionId: null,
    worktreePath: null,
    startedAt: null,
    endedAt: null,
    ...over,
  }
}

function station(id: string, x: number, y: number, w = 1): HallProp {
  return {
    id: `station-${id}`,
    kind: 'desk',
    x,
    y,
    w,
    h: 1,
    solid: true,
    nodeId: id,
    seat: { x, y: y + 1 },
  }
}

// A floor with a station row (y=2) and a belt row (y=3) below it, both
// wide enough to route a straight and a turning belt, inside a room bounded
// by `topWallRow=0` and `roomRow=6`.
function openFloor(width: number, height: number): boolean[][] {
  return Array.from({ length: height }, () => Array(width).fill(false))
}

function roleRows(height: number, stationRow: number): string[] {
  const role = Array(height).fill('wall')
  role[stationRow] = 'station'
  role[stationRow + 1] = 'seat'
  role[stationRow + 2] = 'belt'
  return role
}

describe('routeBelts', () => {
  it('routes a straight belt on the belt row when source and target share a row', () => {
    const a = station('a', 0, 2, 2)
    const b = station('b', 6, 2, 2)
    const nodes = [node({ id: 'a' }), node({ id: 'b', dependsOn: ['a'] })]
    const byNode = new Map([
      ['a', a],
      ['b', b],
    ])
    const solid = openFloor(10, 6)
    const role = roleRows(6, 2)
    const { belts, beltTiles } = routeBelts(nodes, byNode, solid, role, new Set(), 10, 6, 0, 5)
    expect(belts).toHaveLength(1)
    const belt = belts[0]
    expect(belt.path[0]).toEqual({ x: a.x + a.w, y: a.y })
    expect(belt.path[belt.path.length - 1]).toEqual({ x: b.x - 1, y: b.y })
    expect(beltTiles.length).toBeGreaterThan(0)
    expect(beltTiles.every((t) => t.kind === 'straight' || t.kind === 'corner')).toBe(true)
  })

  it('gives the shared tile of two belts from the same source a split, in graph order', () => {
    const a = station('a', 0, 2, 1)
    const b = station('b', 5, 2, 1)
    const c = station('c', 5, 5, 1)
    const nodes = [
      node({ id: 'a' }),
      node({ id: 'b', dependsOn: ['a'] }),
      node({ id: 'c', dependsOn: ['a'] }),
    ]
    const byNode = new Map([
      ['a', a],
      ['b', b],
      ['c', c],
    ])
    const solid = openFloor(8, 8)
    const role = roleRows(8, 2)
    role[5] = 'station'
    role[6] = 'seat'
    role[7] = 'belt'
    const { belts, beltTiles } = routeBelts(nodes, byNode, solid, role, new Set(), 8, 8, 0, 8)
    expect(belts).toHaveLength(2)
    const kinds = beltTiles.map((t) => t.kind)
    expect(kinds).toContain('split')
    const splitTile = beltTiles.find((t) => t.kind === 'split')!
    expect(splitTile.outs.length).toBeGreaterThan(1)
  })

  it('falls back to a plain BFS path when the routed search can never turn', () => {
    // Every row is 'wall', so a horizontal step is never legal for the
    // routed search — it cannot reach a target one column removed no matter
    // how it turns, and must fall back to findPath over `solid`.
    const a = station('a', 0, 2, 1)
    const b = station('b', 4, 2, 1)
    const nodes = [node({ id: 'a' }), node({ id: 'b', dependsOn: ['a'] })]
    const byNode = new Map([
      ['a', a],
      ['b', b],
    ])
    const solid = openFloor(6, 5)
    const role = Array(5).fill('wall')
    const { belts } = routeBelts(nodes, byNode, solid, role, new Set(), 6, 5, 0, 4)
    expect(belts).toHaveLength(1)
    const belt = belts[0]
    expect(belt.path[0]).toEqual({ x: a.x + a.w, y: a.y })
    expect(belt.path[belt.path.length - 1]).toEqual({ x: b.x - 1, y: b.y })
    let prev = belt.path[0]
    for (const t of belt.path.slice(1)) {
      expect(Math.abs(t.x - prev.x) + Math.abs(t.y - prev.y)).toBe(1)
      prev = t
    }
  })

  it('skips an edge whose source or target station is missing from the map', () => {
    const b = station('b', 4, 2, 1)
    const nodes = [node({ id: 'b', dependsOn: ['ghost'] })]
    const byNode = new Map([['b', b]])
    const solid = openFloor(6, 5)
    const role = roleRows(5, 2)
    const { belts, beltTiles } = routeBelts(nodes, byNode, solid, role, new Set(), 6, 5, 0, 4)
    expect(belts).toEqual([])
    expect(beltTiles).toEqual([])
  })
})
