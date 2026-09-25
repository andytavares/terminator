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
const YARD_ROWS = 4
const LANE_BAND_ROWS = 4
const LOUNGE_ROWS = 4
/** How far the room extends past the last station's column — the hall hugs its content. */
const CONTENT_MARGIN = 3
const COLUMN_PITCH = 5
const MIN_WIDTH = 16

type FixtureKind = 'shelves' | 'racks' | 'statuswall' | 'lockers'
const FIXTURE_KINDS: readonly FixtureKind[] = ['shelves', 'racks', 'statuswall', 'lockers']

type LoungeKind = 'couch' | 'coffee' | 'plant' | 'booth'
/** Repeats across the lounge band until the room runs out of width. */
const LOUNGE_PATTERN: readonly { readonly kind: LoungeKind; readonly w: number }[] = [
  { kind: 'plant', w: 1 },
  { kind: 'couch', w: 3 },
  { kind: 'plant', w: 1 },
  { kind: 'coffee', w: 1 },
  { kind: 'booth', w: 3 },
  { kind: 'plant', w: 1 },
]

/** The nearest column in `row` that isn't solid, scanning outward from `preferred`. */
function nearestClearColumn(
  solid: boolean[][],
  row: number,
  preferred: number,
  width: number
): number {
  const clamped = Math.min(Math.max(preferred, 1), width - 2)
  if (!solid[row][clamped]) return clamped
  for (let offset = 1; offset < width; offset++) {
    const right = clamped + offset
    if (right <= width - 2 && !solid[row][right]) return right
    const left = clamped - offset
    if (left >= 1 && !solid[row][left]) return left
  }
  /* v8 ignore next -- a hall always has floor the perimeter fill leaves clear */
  return clamped
}

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
  // The rightmost edge any station actually occupies — the room hugs this,
  // rather than a fixed reserved bay past the deepest column.
  // Nodes sharing a band and a depth stand side by side rather than on top of
  // one another, so a depth column is as wide as its most crowded band.
  const bandKey = (node: RunNode): string => (node.lane === null ? 'yard' : `lane-${node.lane}`)
  const slotOf = new Map<string, number>()
  const slotsAtDepth = new Map<number, number>()
  const taken = new Map<string, number>()
  for (const node of graph.nodes) {
    const depth = nodeDepths.get(node.id) as number
    const key = `${bandKey(node)}@${depth}`
    const slot = taken.get(key) ?? 0
    taken.set(key, slot + 1)
    slotOf.set(node.id, slot)
    slotsAtDepth.set(depth, Math.max(slotsAtDepth.get(depth) ?? 0, slot + 1))
  }
  const maxDepth = Math.max(-1, ...slotsAtDepth.keys())
  const columnStart: number[] = []
  for (let d = 0, x = 3; d <= maxDepth; d++) {
    columnStart.push(x)
    x += COLUMN_PITCH * (slotsAtDepth.get(d) ?? 1)
  }
  const stationX = (node: RunNode): number =>
    columnStart[nodeDepths.get(node.id) as number] + (slotOf.get(node.id) as number) * COLUMN_PITCH

  const rightmostStationEdge =
    graph.nodes.length === 0
      ? 3 + stationWidth('desk')
      : Math.max(...graph.nodes.map((n) => stationX(n) + stationWidth(stationKind(n.kind))))
  const width = Math.max(MIN_WIDTH, rightmostStationEdge + CONTENT_MARGIN)

  const laneValues = [
    ...new Set(graph.nodes.map((n) => n.lane).filter((l): l is number => l !== null)),
  ].sort((a, b) => a - b)

  // One clear row under the wall, so a tall machine in the yard has headroom
  // instead of being drawn up into the wall face.
  const yardStationRow = TOP_WALL_ROWS + 1
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

  // Every lane a node can carry came from `laneValues`, which `laneRowOf` was
  // just built from — a node's lane is always a key of this map.
  const laneRowOf = new Map<number, number>()
  const lanes: HallLane[] = laneValues.map((lane, index) => {
    const row = laneBandStart(index)
    laneRowOf.set(lane, row)
    return { lane, row, label: `Lane ${lane}` }
  })

  // Stations go down first: fixtures and the lounge are dressing placed
  // *around* them, and need to know which floor tiles are already taken.
  const props: HallProp[] = []
  for (const node of graph.nodes) {
    const kind = stationKind(node.kind)
    const w = stationWidth(kind)
    const x = stationX(node)
    const stationRow = node.lane === null ? yardStationRow : (laneRowOf.get(node.lane) as number)
    const h = kind === 'press' ? 2 : 1
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

  // Wall fixtures spread across the whole top wall — decor on row
  // `TOP_WALL_ROWS - 1`, which no station ever touches, so their columns are
  // free to land anywhere. Their floor-level anchor (where an agent actually
  // stands to use one) nudges to the nearest clear column when a station
  // happens to sit directly under the fixture's own column.
  for (const [index, kind] of FIXTURE_KINDS.entries()) {
    const col = Math.round(2 + ((width - 4) * (index + 1)) / (FIXTURE_KINDS.length + 1))
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
  const fixtureCol = (kind: FixtureKind): number => {
    const prop = props.find((p) => p.id === `fixture-${kind}`) as HallProp
    return prop.x
  }
  const archive: Tile = {
    x: nearestClearColumn(solid, TOP_WALL_ROWS, fixtureCol('shelves'), width),
    y: TOP_WALL_ROWS,
  }
  const rack: Tile = {
    x: nearestClearColumn(solid, TOP_WALL_ROWS, fixtureCol('racks'), width),
    y: TOP_WALL_ROWS,
  }
  const wait: Tile = {
    x: nearestClearColumn(solid, yardSeatRow, fixtureCol('statuswall'), width),
    y: yardSeatRow,
  }

  // Lounge/utility band: a repeating strip of furniture across the whole
  // bottom band, never under a station (the lounge band sits below every
  // lane), so there is nothing to dodge.
  const lounge: Tile[] = []
  let loungeX = 1
  let loungeIndex = 0
  while (loungeX < width - 2) {
    const piece = LOUNGE_PATTERN[loungeIndex % LOUNGE_PATTERN.length]
    if (loungeX + piece.w > width - 1) break
    props.push({
      id: `lounge-${piece.kind}-${loungeIndex}`,
      kind: piece.kind,
      x: loungeX,
      y: loungeStart,
      w: piece.w,
      h: 1,
      solid: false,
      nodeId: null,
      seat: null,
    })
    if (piece.w >= 3) {
      lounge.push({ x: loungeX, y: loungeStart }, { x: loungeX + piece.w - 1, y: loungeStart })
    } else {
      lounge.push({ x: loungeX, y: loungeStart })
    }
    loungeX += piece.w + 1
    loungeIndex += 1
  }
  // `width` is never below `MIN_WIDTH` (16), and one partial cycle of
  // `LOUNGE_PATTERN` through a 16-column room already seats 7 — the
  // contract's minimum of 6 needs no separate top-up.

  // Lights: one per ~6 columns, per band (the lounge included).
  const lights: Tile[] = []
  const bandRows = [yardBeltRow, ...laneValues.map((_, i) => laneBandStart(i) + 2), loungeStart]
  for (const row of bandRows) {
    for (let col = 3; col < width - 1; col += 6) lights.push({ x: col, y: row })
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
