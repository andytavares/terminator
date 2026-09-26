import type { RunGraph, RunNode } from '../line/run-graph.js'
import type { StepKind } from '../recipe/parse.js'
import { findPath, distancesFrom } from './path.js'
import { routeBelts } from './belts.js'
import type { BeltTile } from './belts.js'

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

export type { Side, BeltTileKind, BeltTile } from './belts.js'

/** The five prop kinds that carry a `RunNode`; every other kind is decor. */
export type StationKind = 'desk' | 'rig' | 'bench' | 'press' | 'gate'

export type PropKind =
  | StationKind
  | 'shelves'
  | 'racks'
  | 'statuswall'
  | 'lockers'
  | 'plant'
  | 'chair'
  | 'partition'
  | 'restbench'
  | 'sofa'
  | 'table'
  | 'lowtable'
  | 'fridge'
  | 'coffeebar'
  | 'vending'
  | 'dispatch'

/** The synthetic node id the dispatch prop carries — no `RunNode` owns it. */
export const DISPATCH_NODE_ID = 'ci'

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
}

/** A seat in the breakroom — a stable order, left to right, top row then bottom row. */
export interface RestSeat {
  readonly id: number
  readonly tile: Tile
  /** Which way a seated crew member faces. */
  readonly facing: 'N' | 'S'
  /** The bench or sofa prop this seat is on. */
  readonly propId: string
}

export interface Breakroom {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly door: readonly Tile[]
}

export interface HallMap {
  readonly width: number
  readonly height: number
  /** The physical footprint: walls, stations, furniture. */
  readonly solid: readonly (readonly boolean[])[]
  /** `solid` plus belts plus every seat, minus the crossovers — what a crew member actually walks over. */
  readonly walk: readonly (readonly boolean[])[]
  readonly props: readonly HallProp[]
  /** One per `dependsOn` edge, its path routed port to port. */
  readonly belts: readonly HallBelt[]
  /** The union of every belt path, one entry per tile. */
  readonly beltTiles: readonly BeltTile[]
  /** Straight belt tiles opened as a step-over plate, so crew can cross. */
  readonly crossovers: readonly Tile[]
  readonly breakroom: Breakroom
  readonly restSeats: readonly RestSeat[]
  readonly lanes: readonly HallLane[]
  readonly anchors: HallAnchors
  readonly lights: readonly Tile[]
}

export const TILE_PX = 16

const TOP_WALL_ROWS = 3
const YARD_ROWS = 4
const LANE_BAND_ROWS = 4
const BREAKROOM_ROWS = 5
/** How far the room extends past the last station's column — the hall hugs its content. */
const CONTENT_MARGIN = 3
const COLUMN_PITCH = 5
const MIN_WIDTH = 16

type FixtureKind = 'shelves' | 'racks' | 'statuswall' | 'lockers'
const FIXTURE_KINDS: readonly FixtureKind[] = ['shelves', 'racks', 'statuswall', 'lockers']

/** A node crewed by someone, and so one that needs a place to sit when idle. */
const CREWED_KINDS: readonly StepKind[] = ['agent', 'fanout', 'run', 'judge']

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

function key(tile: Tile): string {
  return `${tile.x},${tile.y}`
}

const NEIGHBOUR_STEPS: readonly Tile[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

export function layoutHall(
  graph: RunGraph,
  _labels?: Readonly<Record<string, string>>,
  hasCi?: boolean
): HallMap {
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
    const bandDepthKey = `${bandKey(node)}@${depth}`
    const slot = taken.get(bandDepthKey) ?? 0
    taken.set(bandDepthKey, slot + 1)
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

  const rightmostStationEdge = Math.max(
    -Infinity,
    ...graph.nodes.map((n) => stationX(n) + stationWidth(stationKind(n.kind)))
  )

  const crewed = graph.nodes.filter((n) => n.role !== null || CREWED_KINDS.includes(n.kind))
  const modules = Math.max(3, Math.ceil((crewed.length + 2) / 4))
  const roomWidth = 3 * modules + 6

  const width = Math.max(MIN_WIDTH, rightmostStationEdge + CONTENT_MARGIN, roomWidth + 2)

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

  const roomRow = laneBandStart(laneValues.length)
  const bottomRoomRow = roomRow + BREAKROOM_ROWS
  const height = bottomRoomRow + 1

  const solid: boolean[][] = Array.from({ length: height }, () => Array(width).fill(false))

  // Perimeter: top wall, bottom wall, left/right walls with a door each.
  fillRect(solid, 0, 0, width, TOP_WALL_ROWS, true)
  fillRect(solid, 0, bottomRoomRow, width, 1, true)
  const doorRow = yardBeltRow
  for (let y = TOP_WALL_ROWS; y < bottomRoomRow; y++) {
    if (y !== doorRow) {
      solid[y][0] = true
      solid[y][width - 1] = true
    }
  }
  const intake: Tile = { x: 0, y: doorRow }
  const exit: Tile = { x: width - 1, y: doorRow }

  // A run's CI, drawn as a small tower beside the exit — only when the
  // observation actually carries one (ADR-060: nothing is drawn that the
  // observation does not report).
  const dispatchProps: HallProp[] = hasCi
    ? [
        {
          id: 'dispatch',
          kind: 'dispatch',
          x: Math.max(exit.x - 1, 1),
          y: exit.y,
          w: 1,
          h: 1,
          solid: false,
          nodeId: DISPATCH_NODE_ID,
          seat: null,
        },
      ]
    : []

  // Every lane a node can carry came from `laneValues`, which `laneRowOf` was
  // just built from — a node's lane is always a key of this map.
  const laneRowOf = new Map<number, number>()
  const lanes: HallLane[] = laneValues.map((lane, index) => {
    const row = laneBandStart(index)
    laneRowOf.set(lane, row)
    return { lane, row, label: `Lane ${lane}` }
  })

  // Row roles, for where a belt may run horizontally (and where crossing a
  // seat or an aisle costs a walk more).
  const role: string[] = Array(height).fill('wall')
  role[TOP_WALL_ROWS] = 'head'
  const bandStarts = [yardStationRow, ...laneValues.map((_, i) => laneBandStart(i))]
  for (const r of bandStarts) {
    role[r] = 'station'
    role[r + 1] = 'seat'
    role[r + 2] = 'belt'
    if (r + 3 < roomRow) role[r + 3] = 'aisle'
  }

  // Stations go down first: fixtures and the breakroom are dressing placed
  // *around* them, and need to know which floor tiles are already taken.
  const props: HallProp[] = []
  const blockedForBelt = new Set<string>()
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
    blockedForBelt.add(key(seat))

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
  // Under a station's body, beside its seat: a gap between two stations is
  // where a belt turns down to get round the next one.
  const underStation = [...Array(width).keys()].filter(
    (x) =>
      solid[yardStationRow][x] &&
      !solid[yardSeatRow][x] &&
      !blockedForBelt.has(key({ x, y: yardSeatRow }))
  )
  const statuswallCol = fixtureCol('statuswall')
  const wait: Tile = {
    x:
      underStation.length === 0
        ? nearestClearColumn(solid, yardSeatRow, statuswallCol, width)
        : underStation.reduce((best, x) =>
            Math.abs(x - statuswallCol) < Math.abs(best - statuswallCol) ? x : best
          ),
    y: yardSeatRow,
  }
  for (const anchor of [archive, rack, wait]) blockedForBelt.add(key(anchor))

  // Breakroom: a room in the bottom band, centred on the median crewed
  // station column and clamped inside the hall, with a two-tile door in the
  // middle of its partition.
  const crewedX = crewed
    .map((n) => {
      const stationProp = props.find((p) => p.nodeId === n.id) as HallProp
      return stationProp.x + Math.floor(stationProp.w / 2)
    })
    .sort((a, b) => a - b)
  const median =
    crewedX.length > 0 ? crewedX[Math.floor(crewedX.length / 2)] : Math.floor(width / 2)
  const roomX = Math.min(Math.max(median - Math.floor(roomWidth / 2), 1), width - 1 - roomWidth)
  const doorX = roomX + Math.floor(roomWidth / 2) - 1
  const door: Tile[] = [
    { x: doorX, y: roomRow },
    { x: doorX + 1, y: roomRow },
  ]
  fillRect(solid, roomX, roomRow, roomWidth, 1, true)
  fillRect(solid, roomX, roomRow, 1, BREAKROOM_ROWS, true)
  fillRect(solid, roomX + roomWidth - 1, roomRow, 1, BREAKROOM_ROWS, true)
  for (const d of door) solid[d.y][d.x] = false
  props.push({
    id: 'room-partition',
    kind: 'partition',
    x: roomX,
    y: roomRow,
    w: roomWidth,
    h: BREAKROOM_ROWS,
    solid: true,
    nodeId: null,
    seat: null,
  })

  const put = (id: string, kind: PropKind, x: number, y: number, w = 1, h = 1): void => {
    props.push({ id, kind, x, y, w, h, solid: true, nodeId: null, seat: null })
    fillRect(solid, x, y, w, h, true)
  }
  put('room-fridge', 'fridge', roomX + 1, roomRow + 2)
  put('room-coffee', 'coffeebar', roomX + 1, roomRow + 3)
  put('room-plant-l', 'plant', roomX + 1, roomRow + 4)
  put('room-vending', 'vending', roomX + roomWidth - 2, roomRow + 2)
  put('room-plant-r', 'plant', roomX + roomWidth - 2, roomRow + 4)

  const restSeats: RestSeat[] = []
  for (let m = 0; m < modules; m++) {
    const c = roomX + 4 + 3 * m
    const sofa = m % 2 === 1
    const topId = `room-top-${m}`
    const botId = `room-bot-${m}`
    put(topId, sofa ? 'sofa' : 'restbench', c, roomRow + 2, 2, 1)
    put(`room-table-${m}`, sofa ? 'lowtable' : 'table', c, roomRow + 3, 2, 1)
    put(botId, 'restbench', c, roomRow + 4, 2, 1)
    for (const dx of [0, 1]) {
      restSeats.push({
        id: restSeats.length,
        tile: { x: c + dx, y: roomRow + 2 },
        facing: 'S',
        propId: topId,
      })
    }
    for (const dx of [0, 1]) {
      restSeats.push({
        id: restSeats.length,
        tile: { x: c + dx, y: roomRow + 4 },
        facing: 'N',
        propId: botId,
      })
    }
  }

  // Lights: one per ~6 columns, per belt row, plus one over the breakroom's
  // near seat row.
  const lights: Tile[] = []
  const litRows = [yardBeltRow, ...laneValues.map((_, i) => laneBandStart(i) + 2)]
  for (const row of litRows) {
    for (let col = 3; col < width - 1; col += 6) lights.push({ x: col, y: row })
  }
  lights.push({ x: roomX + Math.floor(roomWidth / 2), y: roomRow + 2 })

  // Belts: one routed path per `dependsOn` edge, sharing tiles only within a
  // split (same source) or merge (same target) group.
  const byNode = new Map(props.filter((p) => p.nodeId !== null).map((p) => [p.nodeId as string, p]))
  const { belts, beltTiles } = routeBelts(
    graph.nodes,
    byNode,
    solid,
    role,
    blockedForBelt,
    width,
    height,
    TOP_WALL_ROWS,
    roomRow
  )

  // Walk grid: solid ∪ belt tiles ∪ every seat. Crossovers open only where
  // the floor would otherwise split, or a station's walk to the breakroom
  // door detours badly around belts.
  const seatKeys = new Set<string>([
    ...props.filter((p) => p.seat !== null).map((p) => key(p.seat as Tile)),
    ...restSeats.map((s) => key(s.tile)),
  ])
  const beltTileAt = new Map(beltTiles.map((t) => [key(t), t]))
  const walk: boolean[][] = solid.map((row, y) =>
    row.map((v, x) => v || beltTileAt.has(key({ x, y })) || seatKeys.has(key({ x, y })))
  )
  const free: boolean[][] = solid.map((row, y) =>
    row.map((v, x) => v || seatKeys.has(key({ x, y })))
  )

  const crossovers: Tile[] = []
  const isPortOfSomeBelt = (t: Tile): boolean =>
    belts.some((b) => {
      const first = b.path[0]
      const last = b.path[b.path.length - 1]
      return (
        (first !== undefined && key(first) === key(t)) ||
        (last !== undefined && key(last) === key(t))
      )
    })
  const isOpenableStraight = (t: Tile): boolean => {
    const tile = beltTileAt.get(key(t))
    return tile !== undefined && tile.kind === 'straight' && !isPortOfSomeBelt(t)
  }
  const open = (t: Tile): void => {
    walk[t.y][t.x] = false
    crossovers.push(t)
  }
  const requiredKeys = [...seatKeys, key(archive), key(rack), key(wait), key(exit)]
  const required: Tile[] = requiredKeys.map((k) => {
    const [x, y] = k.split(',').map(Number)
    return { x, y }
  })
  const reachable = (seen: ReadonlySet<string>, t: Tile): boolean =>
    seen.has(key(t)) || NEIGHBOUR_STEPS.some((s) => seen.has(key({ x: t.x + s.x, y: t.y + s.y })))

  for (let guard = 0; guard < 50; guard++) {
    const seen = new Set(distancesFrom(walk, intake).keys())
    if (required.every((t) => reachable(seen, t))) break
    const candidates = [...beltTileAt.keys()]
      .map((k) => {
        const [x, y] = k.split(',').map(Number)
        return { x, y }
      })
      .filter((t) => {
        if (!isOpenableStraight(t)) return false
        const tile = beltTileAt.get(key(t)) as BeltTile
        const horizontal = tile.outs.includes('E') || tile.outs.includes('W')
        const [p, q] = horizontal
          ? [
              { x: t.x, y: t.y - 1 },
              { x: t.x, y: t.y + 1 },
            ]
          : [
              { x: t.x - 1, y: t.y },
              { x: t.x + 1, y: t.y },
            ]
        const isOpen = (u: Tile): boolean => walk[u.y]?.[u.x] !== true
        return isOpen(p) && isOpen(q) && seen.has(key(p)) !== seen.has(key(q))
      })
      .sort((a, b) => a.y - b.y || a.x - b.x)
    if (candidates.length === 0) break
    open(candidates[0])
  }

  for (const p of props.filter((q) => q.seat !== null)) {
    for (let i = 0; i < 3; i++) {
      const blockedLength = findPath(walk, p.seat as Tile, door[0]).length
      const freePath = findPath(free, p.seat as Tile, door[0])
      if (blockedLength > 0 && blockedLength <= freePath.length + 8) break
      const t = freePath.find((u) => walk[u.y][u.x] && isOpenableStraight(u))
      if (t === undefined) break
      open(t)
    }
  }

  return {
    width,
    height,
    solid,
    walk,
    props: [...props, ...dispatchProps],
    belts,
    beltTiles,
    crossovers,
    breakroom: { x: roomX, y: roomRow, w: roomWidth, h: BREAKROOM_ROWS, door },
    restSeats,
    lanes,
    anchors: { intake, exit, archive, rack, wait },
    lights,
  }
}
