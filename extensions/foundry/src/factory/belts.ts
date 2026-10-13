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
type BeltTileKind = 'straight' | 'corner' | 'split' | 'merge' | 'cross'

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

/** The floor belts are routed over, and the rows between which they may run. */
export interface BeltFloor {
  readonly solid: readonly (readonly boolean[])[]
  /** Each row's role: a belt runs across only a station row or a belt row. */
  readonly role: readonly string[]
  readonly blockedForBelt: ReadonlySet<string>
  readonly width: number
  readonly height: number
  readonly topWallRow: number
  readonly roomRow: number
}

/** One `dependsOn` edge to route: whose belt it is, and from where to where. */
interface Leg {
  readonly fromId: string
  readonly toId: string
  readonly start: Tile
  readonly goal: Tile
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
  floor: BeltFloor
): RouteBeltsResult {
  const router = new BeltRouter(floor)
  for (const node of nodes) {
    for (const fromId of node.dependsOn) {
      const a = byNode.get(fromId)
      const b = byNode.get(node.id)
      if (!a || !b) continue
      router.route({
        fromId,
        toId: node.id,
        start: { x: a.x + a.w, y: a.y },
        goal: { x: b.x - 1, y: b.y },
      })
    }
  }
  return router.result()
}

/** The belts laid so far, and the tiles they share. */
class BeltRouter {
  readonly floor: BeltFloor
  readonly cells = new Map<string, Cell>()
  private readonly belts: HallBelt[] = []

  constructor(floor: BeltFloor) {
    this.floor = floor
  }

  /** Whether a belt may run over this tile at all. */
  passBelt(t: Tile): boolean {
    const { width, topWallRow, roomRow, solid, blockedForBelt } = this.floor
    return (
      t.x >= 1 &&
      t.x < width - 1 &&
      t.y > topWallRow &&
      t.y < roomRow &&
      !solid[t.y][t.x] &&
      !blockedForBelt.has(key(t))
    )
  }

  /** Whether a tile's belts can share it with this leg: the same source (a split) or target (a merge). */
  compatible(c: Cell, leg: Leg): boolean {
    return (
      [...c.from].every((f) => f === leg.fromId) || [...c.to].every((toId) => toId === leg.toId)
    )
  }

  route(leg: Leg): void {
    const path = new BeltSearch(this, leg).run() ?? [
      leg.start,
      ...findPath(this.floor.solid, { from: leg.start, to: leg.goal }),
    ]
    const id = `${leg.fromId}->${leg.toId}`
    this.belts.push({ id, fromNodeId: leg.fromId, toNodeId: leg.toId, path })
    path.forEach((t, i) => this.lay(leg, { t, prevT: path[i - 1], nextT: path[i + 1] }))
  }

  /** One tile of a routed path, into the cell it shares with any belt already there. */
  private lay(leg: Leg, { t, prevT, nextT }: { t: Tile; prevT?: Tile; nextT?: Tile }): void {
    const c = this.cellAt(key(t))
    const inD: Side = prevT ? sideBetween(prevT, t) : 'E'
    const outD: Side = nextT ? sideBetween(t, nextT) : 'E'
    if (c.from.size && !this.compatible(c, leg)) {
      c.over = [OPP[inD], outD]
      return
    }
    c.ins.add(OPP[inD])
    c.outs.add(outD)
    c.from.add(leg.fromId)
    c.to.add(leg.toId)
  }

  private cellAt(k: string): Cell {
    const existing = this.cells.get(k)
    if (existing) return existing
    const c: Cell = {
      ins: new Set(),
      outs: new Set(),
      kind: 'straight',
      over: null,
      from: new Set(),
      to: new Set(),
    }
    this.cells.set(k, c)
    return c
  }

  result(): RouteBeltsResult {
    for (const c of this.cells.values()) c.kind = kindOf(c)
    const beltTiles: BeltTile[] = [...this.cells.entries()].map(([k, c]) => {
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
    return { belts: this.belts, beltTiles }
  }
}

/** The side of `from` that `to` lies on — they are neighbours. */
function sideBetween(from: Tile, to: Tile): Side {
  return SIDES.find((s) => from.x + STEP[s].x === to.x && from.y + STEP[s].y === to.y) as Side
}

/** What a shared tile is drawn as, from the belts that run through it. */
function kindOf(c: Cell): BeltTileKind {
  if (c.over) return 'cross'
  if (c.outs.size > 1) return 'split'
  if (c.ins.size > 1) return 'merge'
  const sides = [...c.ins, ...c.outs]
  return sides.length === 2 &&
    STEP[sides[0]].x + STEP[sides[1]].x === 0 &&
    STEP[sides[0]].y + STEP[sides[1]].y === 0
    ? 'straight'
    : 'corner'
}

/** Dijkstra over (tile, heading) for one leg, against the belts already laid. */
class BeltSearch {
  private readonly router: BeltRouter
  private readonly leg: Leg
  private readonly dist: Float64Array
  private readonly prev: Int32Array
  private readonly heap = new Heap()

  constructor(router: BeltRouter, leg: Leg) {
    this.router = router
    this.leg = leg
    const { width, height } = router.floor
    this.dist = new Float64Array(width * height * 4).fill(Infinity)
    this.prev = new Int32Array(width * height * 4).fill(-1)
  }

  private sid(t: Tile, d: number): number {
    return ((t.y * this.router.floor.width + t.x) << 2) | d
  }

  private tileOf(s: number): Tile {
    const { width } = this.router.floor
    return { x: (s >> 2) % width, y: Math.floor((s >> 2) / width) }
  }

  /** The path from the leg's start to its goal, or null when the floor has none. */
  run(): Tile[] | null {
    const { goal } = this.leg
    const s0 = this.sid(this.leg.start, 0)
    this.dist[s0] = 0
    this.heap.push(0, s0)
    while (this.heap.a.length) {
      const [dcur, s] = this.heap.pop()
      if (dcur > this.dist[s]) continue
      const t = this.tileOf(s)
      if (t.x === goal.x && t.y === goal.y) return this.pathTo(s)
      this.expand(s, { dcur, t })
    }
    return null
  }

  private pathTo(end: number): Tile[] {
    const path: Tile[] = []
    for (let s = end; s >= 0; s = this.prev[s]) path.unshift(this.tileOf(s))
    return path
  }

  private expand(s: number, { dcur, t }: { dcur: number; t: Tile }): void {
    const d = s & 3
    const here = this.router.cells.get(key(t))
    const onCross = here !== undefined && !this.router.compatible(here, this.leg)
    for (let nd2 = 0; nd2 < 4; nd2++) {
      if (onCross && nd2 !== d) continue
      const step = this.step(t, { d, nd2 })
      if (step === null) continue
      const ns = this.sid(step.n, nd2)
      if (dcur + step.cost < this.dist[ns]) {
        this.dist[ns] = dcur + step.cost
        this.prev[ns] = s
        this.heap.push(this.dist[ns], ns)
      }
    }
  }

  /** The tile one step from `t` heading `SIDES[nd2]`, and what the step costs; null when it is no way. */
  private step(t: Tile, { d, nd2 }: { d: number; nd2: number }): { n: Tile; cost: number } | null {
    const { start, goal } = this.leg
    const { role } = this.router.floor
    const dir = SIDES[nd2]
    const n: Tile = { x: t.x + STEP[dir].x, y: t.y + STEP[dir].y }
    const isGoal = n.x === goal.x && n.y === goal.y
    if (!this.mayEnter(t, { n, dir, isGoal })) return null
    let cost = 1 + (nd2 !== d && !(t.x === start.x && t.y === start.y && nd2 === 0) ? 2 : 0)
    if (role[n.y] === 'seat' || role[n.y] === 'aisle') cost += 1
    const shared = this.sharedCost(n, { dir, cost, isGoal })
    return shared === null ? null : { n, cost: shared }
  }

  /** Whether a belt may step from `t` onto `n`: free floor, or the goal, and across only on a belt row. */
  private mayEnter(t: Tile, { n, dir, isGoal }: { n: Tile; dir: Side; isGoal: boolean }): boolean {
    const floorAllows = this.router.passBelt(n) || (isGoal && !this.router.floor.solid[n.y][n.x])
    if (!floorAllows) return false
    const horizontal = dir === 'E' || dir === 'W'
    return !horizontal || (this.beltRow(n.y) && this.beltRow(t.y))
  }

  private beltRow(y: number): boolean {
    const role = this.router.floor.role[y]
    return role === 'station' || role === 'belt'
  }

  /**
   * What stepping onto a tile another belt uses costs: almost nothing along a
   * compatible belt's own way, a little more against it, and a lot to cross an
   * unrelated straight at a right angle — null for any other crossing.
   */
  private sharedCost(
    n: Tile,
    { dir, cost, isGoal }: { dir: Side; cost: number; isGoal: boolean }
  ): number | null {
    const c = this.router.cells.get(key(n))
    if (!c) return cost
    if (this.router.compatible(c, this.leg)) return c.outs.has(dir) ? 0.2 : cost + 1
    const horizontal = dir === 'E' || dir === 'W'
    const cHorizontal = c.outs.has('E') || c.outs.has('W')
    if (cHorizontal === horizontal || c.kind !== 'straight' || isGoal) return null
    return cost + 10
  }
}
