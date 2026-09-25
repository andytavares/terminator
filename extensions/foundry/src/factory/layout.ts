import type { RunGraph, RunNode } from '../line/run-graph.js'
import type { StepKind } from '../recipe/parse.js'
import { findPath } from './path.js'

// A run graph turned into a floor plan.
//
// The map is a pure function of the graph's shape (which nodes, which
// dependencies, which lanes) — never of state, timing or anything that
// changes tick to tick. That is what lets the scene renderer cache a bake of
// it and the simulation lay crew onto it without either one recomputing
// layout every frame.

export interface Tile {
  readonly x: number
  readonly y: number
}

/** The five prop kinds that carry a `RunNode`; every other kind is decor. */
export type StationKind = 'desk' | 'rig' | 'bench' | 'press' | 'gate'

export type PropKind =
  | StationKind
  | 'shelves'
  | 'racks'
  | 'statuswall'
  | 'lockers'
  | 'couch'
  | 'coffee'
  | 'plant'
  | 'booth'
  | 'chair'

export interface HallProp {
  readonly id: string
  readonly kind: PropKind
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly solid: boolean
  readonly nodeId: string | null
  readonly seat: Tile | null
}

export interface HallBelt {
  readonly id: string
  readonly fromNodeId: string
  readonly toNodeId: string
  readonly path: readonly Tile[]
}

export interface HallLane {
  readonly lane: number
  readonly row: number
  readonly label: string
}

export interface HallAnchors {
  readonly intake: Tile
  readonly exit: Tile
  readonly archive: Tile
  readonly rack: Tile
  readonly wait: Tile
  readonly lounge: readonly Tile[]
}

export interface HallMap {
  readonly width: number
  readonly height: number
  readonly solid: readonly (readonly boolean[])[]
  readonly props: readonly HallProp[]
  readonly belts: readonly HallBelt[]
  readonly lanes: readonly HallLane[]
  readonly anchors: HallAnchors
  readonly lights: readonly Tile[]
}

export const TILE_PX = 16

const TOP_WALL_ROWS = 3
const YARD_ROWS = 3
const LANE_BAND_ROWS = 4
const LOUNGE_ROWS = 4
const BUFFER_COLS = 4
const MIN_WIDTH = 24

export function stationKind(kind: StepKind): StationKind {
  switch (kind) {
    case 'agent':
    case 'fanout':
      return 'desk'
    case 'run':
      return 'rig'
    case 'judge':
      return 'bench'
    case 'join':
      return 'press'
    case 'gate':
      return 'gate'
  }
}

function stationWidth(kind: StationKind): number {
  switch (kind) {
    case 'desk':
      return 3
    case 'rig':
    case 'bench':
      return 2
    case 'press':
      return 3
    case 'gate':
      return 1
  }
}

/** The longest path from a root (empty `dependsOn`) to each node, over node ids. */
function depths(nodes: readonly RunNode[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const memo = new Map<string, number>()

  function depthOf(id: string, seen: Set<string>): number {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    if (seen.has(id)) return 0
    const node = byId.get(id)
    if (node === undefined || node.dependsOn.length === 0) {
      memo.set(id, 0)
      return 0
    }
    const nextSeen = new Set(seen).add(id)
    const value = 1 + Math.max(...node.dependsOn.map((dep) => depthOf(dep, nextSeen)))
    memo.set(id, value)
    return value
  }

  for (const node of nodes) depthOf(node.id, new Set())
  return memo
}

// Every caller passes a rect the grid was already sized to hold — the
// perimeter fills the exact width/height, and a station's (x, y, w, h) comes
// from the same band/column arithmetic that sized the grid in the first
// place — so there is no bounds check here to test around.
function fillRect(
  solid: boolean[][],
  x: number,
  y: number,
  w: number,
  h: number,
  value: boolean
): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      solid[yy][xx] = value
    }
  }
}

export function layoutHall(graph: RunGraph, _labels?: Readonly<Record<string, string>>): HallMap {
  const nodeDepths = depths(graph.nodes)
  const maxDepth = graph.nodes.length === 0 ? 0 : Math.max(...[...nodeDepths.values()])
  const width = Math.max(MIN_WIDTH, 3 + (maxDepth + 1) * 5 + BUFFER_COLS)

  const laneValues = [
    ...new Set(graph.nodes.map((n) => n.lane).filter((l): l is number => l !== null)),
  ].sort((a, b) => a - b)

  const yardStationRow = TOP_WALL_ROWS
  const yardSeatRow = yardStationRow + 1
  const yardBeltRow = yardStationRow + 2

  function laneBandStart(index: number): number {
    return TOP_WALL_ROWS + YARD_ROWS + index * LANE_BAND_ROWS
  }

  const loungeStart = laneBandStart(laneValues.length)
  const bottomWallRow = loungeStart + LOUNGE_ROWS
  const height = bottomWallRow + 1

  const solid: boolean[][] = Array.from({ length: height }, () => Array(width).fill(false))

  // Perimeter: top wall, bottom wall, left/right walls with a door each.
  fillRect(solid, 0, 0, width, TOP_WALL_ROWS, true)
  fillRect(solid, 0, bottomWallRow, width, 1, true)
  const doorRow = yardBeltRow
  for (let y = TOP_WALL_ROWS; y < bottomWallRow; y++) {
    if (y !== doorRow) {
      solid[y][0] = true
      solid[y][width - 1] = true
    }
  }
  const intake: Tile = { x: 0, y: doorRow }
  const exit: Tile = { x: width - 1, y: doorRow }

  // Wall fixtures live in the reserved buffer columns at the right edge, so
  // they never collide with a station column (every station sits below
  // width - BUFFER_COLS).
  const bayStart = width - BUFFER_COLS - 1
  const props: HallProp[] = []
  const fixtureCols: Record<'shelves' | 'racks' | 'statuswall' | 'lockers', number> = {
    shelves: bayStart,
    racks: bayStart + 1,
    statuswall: bayStart + 2,
    lockers: bayStart + 3,
  }
  for (const [kind, col] of Object.entries(fixtureCols) as [keyof typeof fixtureCols, number][]) {
    props.push({
      id: `fixture-${kind}`,
      kind,
      x: col,
      y: TOP_WALL_ROWS - 1,
      w: 1,
      h: 1,
      solid: true,
      nodeId: null,
      seat: null,
    })
  }
  const archive: Tile = { x: fixtureCols.shelves, y: yardStationRow }
  const rack: Tile = { x: fixtureCols.racks, y: yardStationRow }
  const wait: Tile = { x: fixtureCols.statuswall, y: yardSeatRow }

  // Lounge/utility band, in the same reserved bay so it never collides with a
  // station either.
  const loungeKinds: PropKind[] = ['couch', 'coffee', 'plant', 'booth']
  for (const [index, kind] of loungeKinds.entries()) {
    const col = bayStart + index
    props.push({
      id: `lounge-${kind}`,
      kind,
      x: col,
      y: loungeStart,
      w: 1,
      h: 1,
      solid: false,
      nodeId: null,
      seat: null,
    })
  }
  // `width` is never less than MIN_WIDTH, so the first row alone always
  // yields at least 6 columns before the 12-tile cap — the minimum the
  // `HallAnchors.lounge` contract asks for.
  const lounge: Tile[] = []
  for (let row = loungeStart; row < loungeStart + LOUNGE_ROWS; row++) {
    for (let col = 1; col < bayStart; col += 3) {
      lounge.push({ x: col, y: row })
      if (lounge.length >= 12) break
    }
    if (lounge.length >= 12) break
  }

  // Lights: one per ~6 columns, per band.
  const lights: Tile[] = []
  const bandRows = [yardBeltRow, ...laneValues.map((_, i) => laneBandStart(i) + 2), loungeStart]
  for (const row of bandRows) {
    for (let col = 3; col < width - 1; col += 6) lights.push({ x: col, y: row })
  }

  // Every lane a node can carry came from `laneValues`, which `laneRowOf` was
  // just built from — a node's lane is always a key of this map.
  const laneRowOf = new Map<number, number>()
  const lanes: HallLane[] = laneValues.map((lane, index) => {
    const row = laneBandStart(index)
    laneRowOf.set(lane, row)
    return { lane, row, label: `Lane ${lane}` }
  })

  for (const node of graph.nodes) {
    const kind = stationKind(node.kind)
    const w = stationWidth(kind)
    // `depths` visits every node in the graph, so this is always populated.
    const depth = nodeDepths.get(node.id) as number
    const x = 3 + depth * 5
    const stationRow = node.lane === null ? yardStationRow : (laneRowOf.get(node.lane) as number)
    const h = 1
    const y = stationRow
    const seat: Tile = { x: x + Math.floor(w / 2), y: y + h }

    props.push({
      id: `station-${node.id}`,
      kind,
      x,
      y,
      w,
      h,
      solid: true,
      nodeId: node.id,
      seat,
    })
    fillRect(solid, x, y, w, h, true)
    solid[seat.y][seat.x] = false

    if (kind === 'desk') {
      props.push({
        id: `chair-${node.id}`,
        kind: 'chair',
        x: seat.x,
        y: seat.y,
        w: 1,
        h: 1,
        solid: false,
        nodeId: null,
        seat: null,
      })
    }
  }

  const stationById = new Map(
    props.filter((p) => p.nodeId !== null).map((p) => [p.nodeId as string, p])
  )

  const belts: HallBelt[] = []
  for (const node of graph.nodes) {
    // `node` came from `graph.nodes`, which the loop above gave a station to
    // unconditionally, so the target side is always found; the source side
    // is not — `dependsOn` can name an id no node in this graph carries.
    const toProp = stationById.get(node.id) as HallProp
    for (const fromNodeId of node.dependsOn) {
      const fromProp = stationById.get(fromNodeId)
      if (fromProp === undefined) continue
      const beltRow = fromProp.y + 2
      const start: Tile = {
        x: Math.min(Math.max(fromProp.x + Math.floor(fromProp.w / 2), 1), width - 2),
        y: Math.min(beltRow, height - 2),
      }
      const path = findPath(solid, start, toProp.seat as Tile)
      belts.push({ id: `${fromNodeId}->${node.id}`, fromNodeId, toNodeId: node.id, path })
    }
  }

  return {
    width,
    height,
    solid,
    props,
    belts,
    lanes,
    anchors: { intake, exit, archive, rack, wait, lounge },
    lights,
  }
}
