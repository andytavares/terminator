import type { RunNode } from '../line/run-graph.js'
import type { HallBelt, HallProp, Tile } from './layout.js'
import { findPath } from './path.js'

// Routes one belt per `dependsOn` edge, port to port, and turns the union of
// their paths into drawable tiles (straight, corner, split, merge, cross).
//
// The search is Dijkstra over (tile, heading): a step costs 1, a turn costs
// 2 more, and reusing a tile already carrying a compatible belt (same
// source, for a split, or same target, for a merge) costs almost nothing —
// that is what pulls belts into a shared trunk instead of laying parallel
// track. Crossing an unrelated belt is allowed only at a right angle over a
// straight tile, and costs a lot more. Edges are routed in graph order, so
// ties resolve the same way every time.

export type Side = 'N' | 'S' | 'E' | 'W'
export type BeltTileKind = 'straight' | 'corner' | 'split' | 'merge' | 'cross'

export interface BeltTile {
  readonly x: number
  readonly y: number
  readonly ins: readonly Side[]
  readonly outs: readonly Side[]
  readonly kind: BeltTileKind
  readonly over: { readonly from: Side; readonly to: Side } | null
}

const STEP: Record<Side, Tile> = {
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
}
const OPP: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' }
// Fixed exploration order at every Dijkstra step — it decides which of two
// equal-cost routes wins, so it has to be the same order every run.
const SIDES: readonly Side[] = ['E', 'S', 'N', 'W']

function key(tile: Tile): string {
  return `${tile.x},${tile.y}`
}

// A binary min-heap of (priority, state id) pairs.
class Heap {
  a: [number, number][] = []
  push(p: number, v: number): void {
    const a = this.a
    a.push([p, v])
    let i = a.length - 1
    while (i) {
      const j = (i - 1) >> 1
      if (a[j][0] <= a[i][0]) break
      ;[a[i], a[j]] = [a[j], a[i]]
      i = j
    }
  }
  pop(): [number, number] {
    const a = this.a
    const top = a[0]
    const last = a.pop() as [number, number]
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l][0] < a[m][0]) m = l
        if (r < a.length && a[r][0] < a[m][0]) m = r
        if (m === i) break
        ;[a[i], a[m]] = [a[m], a[i]]
        i = m
      }
    }
    return top
  }
}

interface Cell {
  ins: Set<Side>
  outs: Set<Side>
  kind: BeltTileKind
  over: [Side, Side] | null
  from: Set<string>
  to: Set<string>
}

export interface RouteBeltsResult {
  readonly belts: readonly HallBelt[]
  readonly beltTiles: readonly BeltTile[]
}

/**
 * Routes one belt per `dependsOn` edge from the tile east of its source to
 * the tile west of its target, over the tiles where `passBelt` allows a
 * belt at all (a station row or a belt row, never a seat, an anchor or the
 * breakroom band). Falls back to `findPath` over `solid` when the routed
 * search finds no way through — the caller is expected to fail a test on
 * that fallback, never to ship it silently.
 */
export function routeBelts(
  nodes: readonly RunNode[],
  byNode: ReadonlyMap<string, HallProp>,
  solid: readonly (readonly boolean[])[],
  role: readonly string[],
  blockedForBelt: ReadonlySet<string>,
  width: number,
  height: number,
  topWallRow: number,
  roomRow: number
): RouteBeltsResult {
  const cells = new Map<string, Cell>()
  const belts: HallBelt[] = []

  const passBelt = (t: Tile): boolean =>
    t.x >= 1 &&
    t.x < width - 1 &&
    t.y > topWallRow &&
    t.y < roomRow &&
    !solid[t.y][t.x] &&
    !blockedForBelt.has(key(t))

  for (const node of nodes) {
    for (const fromId of node.dependsOn) {
      const a = byNode.get(fromId)
      const b = byNode.get(node.id)
      if (!a || !b) continue
      const start: Tile = { x: a.x + a.w, y: a.y }
      const goal: Tile = { x: b.x - 1, y: b.y }

      const S = width * height * 4
      const dist = new Float64Array(S).fill(Infinity)
      const prev = new Int32Array(S).fill(-1)
      const sid = (t: Tile, d: number): number => ((t.y * width + t.x) << 2) | d
      const heap = new Heap()
      const s0 = sid(start, 0)
      dist[s0] = 0
      heap.push(0, s0)
      let end = -1

      const compatible = (c: Cell): boolean =>
        [...c.from].every((f) => f === fromId) || [...c.to].every((toId) => toId === node.id)

      while (heap.a.length) {
        const [dcur, s] = heap.pop()
        if (dcur > dist[s]) continue
        const d = s & 3
        const t: Tile = { x: (s >> 2) % width, y: Math.floor((s >> 2) / width) }
        if (t.x === goal.x && t.y === goal.y) {
          end = s
          break
        }
        const here = cells.get(key(t))
        const onCross = here !== undefined && !compatible(here)
        for (let nd2 = 0; nd2 < 4; nd2++) {
          const dir = SIDES[nd2]
          if (onCross && nd2 !== d) continue
          const n: Tile = { x: t.x + STEP[dir].x, y: t.y + STEP[dir].y }
          const isGoal = n.x === goal.x && n.y === goal.y
          if (!isGoal && !passBelt(n)) continue
          if (isGoal && !passBelt(n) && solid[n.y][n.x]) continue
          const horizontal = dir === 'E' || dir === 'W'
          if (horizontal && role[n.y] !== 'station' && role[n.y] !== 'belt') continue
          if (horizontal && role[t.y] !== 'station' && role[t.y] !== 'belt') continue
          let cost = 1 + (nd2 !== d && !(t.x === start.x && t.y === start.y && nd2 === 0) ? 2 : 0)
          if (role[n.y] === 'seat' || role[n.y] === 'aisle') cost += 1
          const c = cells.get(key(n))
          if (c) {
            if (compatible(c)) cost = c.outs.has(dir) ? 0.2 : cost + 1
            else {
              const cHorizontal = c.outs.has('E') || c.outs.has('W')
              if (cHorizontal === horizontal || c.kind !== 'straight' || isGoal) continue
              cost += 10
            }
          }
          const ns = sid(n, nd2)
          if (dcur + cost < dist[ns]) {
            dist[ns] = dcur + cost
            prev[ns] = s
            heap.push(dist[ns], ns)
          }
        }
      }

      let path: Tile[]
      if (end < 0) {
        path = [start, ...findPath(solid, start, goal)]
      } else {
        path = []
        for (let s = end; s >= 0; s = prev[s]) {
          path.unshift({ x: (s >> 2) % width, y: Math.floor((s >> 2) / width) })
        }
      }

      const id = `${fromId}->${node.id}`
      belts.push({ id, fromNodeId: fromId, toNodeId: node.id, path })

      path.forEach((t, i) => {
        const k = key(t)
        let c = cells.get(k)
        if (!c) {
          c = {
            ins: new Set(),
            outs: new Set(),
            kind: 'straight',
            over: null,
            from: new Set(),
            to: new Set(),
          }
          cells.set(k, c)
        }
        const prevT = path[i - 1]
        const nextT = path[i + 1]
        const inD: Side = prevT
          ? (SIDES.find((s) => prevT.x + STEP[s].x === t.x && prevT.y + STEP[s].y === t.y) as Side)
          : 'E'
        const outD: Side = nextT
          ? (SIDES.find((s) => t.x + STEP[s].x === nextT.x && t.y + STEP[s].y === nextT.y) as Side)
          : 'E'
        if (c.from.size && !compatible(c)) {
          c.over = [OPP[inD], outD]
          return
        }
        c.ins.add(OPP[inD])
        c.outs.add(outD)
        c.from.add(fromId)
        c.to.add(node.id)
      })
    }
  }

  for (const c of cells.values()) {
    const sides = [...c.ins, ...c.outs]
    c.kind = c.over
      ? 'cross'
      : c.outs.size > 1
        ? 'split'
        : c.ins.size > 1
          ? 'merge'
          : sides.length === 2 &&
              STEP[sides[0]].x + STEP[sides[1]].x === 0 &&
              STEP[sides[0]].y + STEP[sides[1]].y === 0
            ? 'straight'
            : 'corner'
  }

  const beltTiles: BeltTile[] = [...cells.entries()].map(([k, c]) => {
    const [x, y] = k.split(',').map(Number)
    return {
      x,
      y,
      ins: [...c.ins],
      outs: [...c.outs],
      kind: c.kind,
      over: c.over ? { from: c.over[0], to: c.over[1] } : null,
    }
  })

  return { belts, beltTiles }
}
