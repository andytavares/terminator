import type { RunGraph, RunNode } from '../line/run-graph.js'
import type { StepKind } from '../recipe/parse.js'
import { findPath, distancesFrom } from './path.js'
import { routeBelts } from './belts.js'
import type { BeltTile, RouteBeltsResult } from './belts.js'

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

export type { Side, BeltTile } from './belts.js'

/**
 * The five prop kinds that carry a `RunNode`; every other kind is decor.
 * @internal
 */
export type StationKind = 'desk' | 'rig' | 'press' | 'gate'

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
  /** The name stencilled on the floor by a station — null for everything that is not one. */
  readonly sign: string | null
}

export interface HallBelt {
  readonly id: string
  readonly fromNodeId: string
  readonly toNodeId: string
  readonly path: readonly Tile[]
}

interface HallLane {
  readonly lane: number
  readonly row: number
  readonly label: string
}

interface HallAnchors {
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

interface Breakroom {
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
const LANE_BAND_ROWS = 4
/** A yard band is a lane band: a station row, a seat row, a belt row, an aisle. */
const YARD_ROWS = LANE_BAND_ROWS
const BREAKROOM_ROWS = 5
/** How far the room extends past the last station's column — the hall hugs its content. */
const CONTENT_MARGIN = 3
const COLUMN_PITCH = 5
const MIN_WIDTH = 16

type FixtureKind = 'shelves' | 'racks' | 'statuswall' | 'lockers'
const FIXTURE_KINDS: readonly FixtureKind[] = ['shelves', 'racks', 'statuswall', 'lockers']

/** A node crewed by someone, and so one that needs a place to sit when idle. */
const CREWED_KINDS: readonly StepKind[] = ['agent', 'fanout', 'run']

/** The nearest column in `row` that isn't solid, scanning outward from `preferred`. */
/** The two tiles either side of a belt tile, across the way the belt runs. */
function sidesOf(t: Tile, horizontal: boolean): readonly [Tile, Tile] {
  return horizontal
    ? [
        { x: t.x, y: t.y - 1 },
        { x: t.x, y: t.y + 1 },
      ]
    : [
        { x: t.x - 1, y: t.y },
        { x: t.x + 1, y: t.y },
      ]
}

// On a tie the right-hand column wins; with no clear column, the preferred one.
function nearestClearColumn(solid: boolean[][], row: number, preferred: number): number {
  const width = solid[row].length
  const clamped = Math.min(Math.max(preferred, 1), width - 2)
  const distance = (x: number): number => Math.abs(x - clamped)
  return [...Array(width - 2).keys()]
    .map((i) => i + 1)
    .reduce(
      (best, x) =>
        !solid[row][x] && (solid[row][best] || distance(x) <= distance(best)) ? x : best,
      clamped
    )
}

/** @internal */
export function stationKind(kind: StepKind): StationKind {
  switch (kind) {
    case 'agent':
    case 'fanout':
      return 'desk'
    case 'run':
      return 'rig'
    case 'join':
      return 'press'
    case 'gate':
      return 'gate'
  }
}

/**
 * How many characters of a name fit on the floor in front of a station: its
 * width in pixels (`stationWidth` tiles) at four pixels a glyph.
 * @internal
 */
export const SIGN_CHARS: Readonly<Record<StationKind, number>> = {
  desk: 12,
  press: 12,
  rig: 8,
  gate: 4,
}

function foldSign(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9 -]/g, '-')
}

/**
 * The name a station wears, from the node itself: who does the work (its role,
 * else its step) and — for a node with exactly one unit — which unit. The
 * longest of "who unit", "unit", "who" that fits wins; a name that fits none
 * is cut and ends in a full stop. Every character the pixel font lacks
 * becomes a hyphen.
 * @internal
 */
export function signText(node: RunNode, maxChars: number): string {
  const named = (node.role ?? node.stepId).trim()
  const who = foldSign(named === '' ? node.id : named)
  const unit = node.unitIds.length === 1 ? foldSign(node.unitIds[0]) : null
  const candidates = unit === null ? [who] : [`${who} ${unit}`, unit, who]
  for (const candidate of candidates) if (candidate.length <= maxChars) return candidate
  return who.slice(0, maxChars - 1) + '.'
}

function stationWidth(kind: StationKind): number {
  switch (kind) {
    case 'desk':
      return 3
    case 'rig':
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

/**
 * The yard nodes that stand on a second row: the short branch of an uneven
 * fork. A yard node qualifies when everything downstream of it skips at least
 * one depth column (it merges further on than the next column) while a
 * sibling at its own depth does not — that sibling's longer branch keeps the
 * main row, and the short one runs beside it to the merge.
 */
function offshootIds(nodes: readonly RunNode[], depthOf: ReadonlyMap<string, number>): Set<string> {
  const skips = (node: RunNode): boolean => {
    const dependents = nodes.filter((n) => n.dependsOn.includes(node.id))
    const here = depthOf.get(node.id) as number
    return (
      dependents.length > 0 && dependents.every((n) => (depthOf.get(n.id) as number) > here + 1)
    )
  }
  const yard = nodes.filter((n) => n.lane === null)
  const offshoots = new Set<string>()
  for (const node of yard) {
    if (!skips(node)) continue
    const siblings = yard.filter((n) => n !== node && depthOf.get(n.id) === depthOf.get(node.id))
    if (siblings.some((n) => !skips(n))) offshoots.add(node.id)
  }
  return offshoots
}

// Every caller passes a rect the grid was already sized to hold — the
// perimeter fills the exact width/height, and a station's (x, y, w, h) comes
// from the same band/column arithmetic that sized the grid in the first
// place — so there is no bounds check here to test around.
function fillRect(solid: boolean[][], [x, y, w, h]: Area, value: boolean): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      solid[yy][xx] = value
    }
  }
}

/** A rectangle of tiles: left, top, width, height. */
type Area = readonly [x: number, y: number, w: number, h: number]

function key(tile: Tile): string {
  return `${tile.x},${tile.y}`
}

const NEIGHBOUR_STEPS: readonly Tile[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

/** Which column each node stands in, and which yard nodes take the second yard row. */
interface Columns {
  readonly stationX: (node: RunNode) => number
  readonly offshoots: ReadonlySet<string>
}

function columnsOf(nodes: readonly RunNode[]): Columns {
  const nodeDepths = depths(nodes)
  // Nodes sharing a band and a depth stand side by side rather than on top of
  // one another, so a depth column is as wide as its most crowded band.
  const offshoots = offshootIds(nodes, nodeDepths)
  const bandKey = (node: RunNode): string =>
    node.lane !== null ? `lane-${node.lane}` : offshoots.has(node.id) ? 'yard-2' : 'yard'
  const slotOf = new Map<string, number>()
  const slotsAtDepth = new Map<number, number>()
  const taken = new Map<string, number>()
  for (const node of nodes) {
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
  return { stationX, offshoots }
}

/** The hall's rows, top to bottom: the yard bands, a band per lane, then the breakroom. */
interface Rows {
  readonly laneValues: readonly number[]
  /** One clear row under the wall, so a tall machine in the yard has headroom. */
  readonly yardStationRow: number
  readonly yardSeatRow: number
  readonly yardBeltRow: number
  /** A second yard band, directly under the first, for the short branch of an uneven fork. */
  readonly yardBands: 1 | 2
  readonly yardStationRow2: number
  readonly roomRow: number
  readonly bottomRoomRow: number
  readonly height: number
  readonly laneBandStart: (index: number) => number
}

function rowsOf(nodes: readonly RunNode[], offshoots: ReadonlySet<string>): Rows {
  const laneValues = [
    ...new Set(nodes.map((n) => n.lane).filter((l): l is number => l !== null)),
  ].sort((a, b) => a - b)
  // One clear row under the wall, so a tall machine in the yard has headroom
  // instead of being drawn up into the wall face.
  const yardStationRow = TOP_WALL_ROWS + 1
  const yardBands = offshoots.size > 0 ? 2 : 1
  const laneBandStart = (index: number): number =>
    TOP_WALL_ROWS + YARD_ROWS * yardBands + index * LANE_BAND_ROWS
  const roomRow = laneBandStart(laneValues.length)
  const bottomRoomRow = roomRow + BREAKROOM_ROWS
  return {
    laneValues,
    yardStationRow,
    yardSeatRow: yardStationRow + 1,
    yardBeltRow: yardStationRow + 2,
    yardBands,
    yardStationRow2: yardStationRow + YARD_ROWS,
    roomRow,
    bottomRoomRow,
    height: bottomRoomRow + 1,
    laneBandStart,
  }
}

/**
 * Row roles, for where a belt may run horizontally (and where crossing a
 * seat or an aisle costs a walk more).
 */
function rowRoles(rows: Rows): string[] {
  const role: string[] = Array(rows.height).fill('wall')
  role[TOP_WALL_ROWS] = 'head'
  const bandStarts = [
    rows.yardStationRow,
    ...(rows.yardBands === 2 ? [rows.yardStationRow2] : []),
    ...rows.laneValues.map((_, i) => rows.laneBandStart(i)),
  ]
  for (const r of bandStarts) {
    role[r] = 'station'
    role[r + 1] = 'seat'
    role[r + 2] = 'belt'
    if (r + 3 < rows.roomRow) role[r + 3] = 'aisle'
  }
  return role
}

/** A prop that is only furniture: solid, with no node, seat or sign. */
function decor(id: string, kind: PropKind, [x, y, w, h]: Area): HallProp {
  return { id, kind, x, y, w, h, solid: true, nodeId: null, seat: null, sign: null }
}

export function layoutHall(
  graph: RunGraph,
  _labels?: Readonly<Record<string, string>>,
  hasCi?: boolean
): HallMap {
  const hall = new HallBuilder(graph)
  hall.placeStations()
  hall.placeFixtures()
  const wait = hall.waitTile()
  const room = hall.placeBreakroom()
  const crossings = hall.crossings(room.restSeats)
  crossings.openUntilReachable([...crossings.seatKeys, key(wait), key(hall.exit)], hall.intake)
  // The archive and the rack stand at the wall in a column nobody has to
  // walk behind a station to reach, and their fixture moves over them.
  const reachedFromIntake = distancesFrom(crossings.walk, hall.intake)
  const anchors: HallAnchors = {
    intake: hall.intake,
    exit: hall.exit,
    archive: hall.standAtWall('shelves', reachedFromIntake),
    rack: hall.standAtWall('racks', reachedFromIntake),
    wait,
  }
  crossings.openSeatWays(hall.props, room.door[0])
  return hall.map({ room, crossings, anchors, hasCi })
}

/** What `HallBuilder.map` assembles the finished hall from. */
interface Finished {
  readonly room: { readonly x: number; readonly door: Tile[]; readonly restSeats: RestSeat[] }
  readonly crossings: Crossings
  readonly anchors: HallAnchors
  readonly hasCi: boolean | undefined
}

/** The hall as it is laid out: its size, its solid floor, and the props placed so far. */
class HallBuilder {
  readonly graph: RunGraph
  readonly columns: Columns
  readonly rows: Rows
  /** Nodes crewed by someone, and so ones that need a place to sit when idle. */
  readonly crewed: readonly RunNode[]
  readonly modules: number
  readonly roomWidth: number
  readonly width: number
  readonly height: number
  readonly solid: boolean[][]
  readonly role: string[]
  readonly props: HallProp[] = []
  readonly blockedForBelt = new Set<string>()
  readonly intake: Tile
  readonly exit: Tile
  readonly lanes: HallLane[]
  /** Every lane a node can carry came from `laneValues`, which this was built from. */
  readonly laneRowOf = new Map<number, number>()

  constructor(graph: RunGraph) {
    this.graph = graph
    this.columns = columnsOf(graph.nodes)
    this.rows = rowsOf(graph.nodes, this.columns.offshoots)
    this.crewed = graph.nodes.filter((n) => n.role !== null || CREWED_KINDS.includes(n.kind))
    this.modules = Math.max(3, Math.ceil((this.crewed.length + 2) / 4))
    this.roomWidth = 3 * this.modules + 6
    // The rightmost edge any station actually occupies — the room hugs this,
    // rather than a fixed reserved bay past the deepest column.
    const rightmostStationEdge = Math.max(
      -Infinity,
      ...graph.nodes.map((n) => this.columns.stationX(n) + stationWidth(stationKind(n.kind)))
    )
    this.width = Math.max(MIN_WIDTH, rightmostStationEdge + CONTENT_MARGIN, this.roomWidth + 2)
    this.height = this.rows.height
    this.solid = Array.from({ length: this.height }, () => Array(this.width).fill(false))
    this.role = rowRoles(this.rows)
    const doorRow = this.rows.yardBeltRow
    this.intake = { x: 0, y: doorRow }
    this.exit = { x: this.width - 1, y: doorRow }
    this.walls()
    this.lanes = this.rows.laneValues.map((lane, index) => {
      const row = this.rows.laneBandStart(index)
      this.laneRowOf.set(lane, row)
      return { lane, row, label: `Lane ${lane}` }
    })
  }

  /** The finished hall. */
  map({ room, crossings, anchors, hasCi }: Finished): HallMap {
    return {
      width: this.width,
      height: this.height,
      solid: this.solid,
      walk: crossings.walk,
      props: [...this.props, ...this.dispatchProps(hasCi)],
      belts: crossings.belts,
      beltTiles: crossings.beltTiles,
      crossovers: crossings.crossovers,
      breakroom: {
        x: room.x,
        y: this.rows.roomRow,
        w: this.roomWidth,
        h: BREAKROOM_ROWS,
        door: room.door,
      },
      restSeats: room.restSeats,
      lanes: this.lanes,
      anchors,
      lights: this.lightsOver(room.x),
    }
  }

  /** Perimeter: top wall, bottom wall, left/right walls with a door each. */
  private walls(): void {
    const { solid, width } = this
    const { bottomRoomRow, yardBeltRow: doorRow } = this.rows
    fillRect(solid, [0, 0, width, TOP_WALL_ROWS], true)
    fillRect(solid, [0, bottomRoomRow, width, 1], true)
    for (let y = TOP_WALL_ROWS; y < bottomRoomRow; y++) {
      if (y !== doorRow) {
        solid[y][0] = true
        solid[y][width - 1] = true
      }
    }
  }

  /**
   * A run's CI, drawn as a small tower beside the exit — only when the
   * observation actually carries one (ADR-060: nothing is drawn that the
   * observation does not report).
   */
  dispatchProps(hasCi: boolean | undefined): HallProp[] {
    if (!hasCi) return []
    const { exit } = this
    return [
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
        sign: null,
      },
    ]
  }

  /**
   * Stations go down first: fixtures and the breakroom are dressing placed
   * *around* them, and need to know which floor tiles are already taken.
   */
  placeStations(): void {
    for (const node of this.graph.nodes) this.placeStation(node)
  }

  /** One node's station, its seat left open in front of it, and a chair at a desk. */
  private placeStation(node: RunNode): void {
    const kind = stationKind(node.kind)
    const w = stationWidth(kind)
    const x = this.columns.stationX(node)
    const h = kind === 'press' ? 2 : 1
    const y = this.stationRowOf(node)
    const seat: Tile = { x: x + Math.floor(w / 2), y: y + h }
    const sign = signText(node, SIGN_CHARS[kind])
    this.props.push({
      id: `station-${node.id}`,
      kind,
      x,
      y,
      w,
      h,
      solid: true,
      nodeId: node.id,
      seat,
      sign,
    })
    fillRect(this.solid, [x, y, w, h], true)
    this.solid[seat.y][seat.x] = false
    this.blockedForBelt.add(key(seat))
    if (kind !== 'desk') return
    this.props.push({
      ...decor(`chair-${node.id}`, 'chair', [seat.x, seat.y, 1, 1]),
      solid: false,
    })
  }

  private stationRowOf(node: RunNode): number {
    if (node.lane !== null) return this.laneRowOf.get(node.lane) as number
    return this.columns.offshoots.has(node.id)
      ? this.rows.yardStationRow2
      : this.rows.yardStationRow
  }

  /**
   * Wall fixtures spread across the whole top wall — decor on row
   * `TOP_WALL_ROWS - 1`, which no station ever touches, so their columns are
   * free to land anywhere. Their floor-level anchor (where an agent actually
   * stands to use one) nudges to the nearest clear column when a station
   * happens to sit directly under the fixture's own column.
   */
  placeFixtures(): void {
    for (const [index, kind] of FIXTURE_KINDS.entries()) {
      const col = Math.round(2 + ((this.width - 4) * (index + 1)) / (FIXTURE_KINDS.length + 1))
      // The scoreboard is three tiles wide, centred on its column.
      const board = kind === 'statuswall'
      this.props.push(
        decor(`fixture-${kind}`, kind, [board ? col - 1 : col, TOP_WALL_ROWS - 1, board ? 3 : 1, 1])
      )
    }
  }

  fixtureCol(kind: FixtureKind): number {
    const prop = this.props.find((p) => p.id === `fixture-${kind}`) as HallProp
    return prop.x + Math.floor(prop.w / 2)
  }

  /**
   * Where a crew member waits for a gate: under a station's body, beside its
   * seat — a gap between two stations is where a belt turns down to get round
   * the next one — as near the scoreboard as there is one.
   */
  waitTile(): Tile {
    const { solid, width } = this
    const { yardStationRow, yardSeatRow } = this.rows
    const underStation = [...Array(width).keys()].filter(
      (x) =>
        solid[yardStationRow][x] &&
        !solid[yardSeatRow][x] &&
        !this.blockedForBelt.has(key({ x, y: yardSeatRow }))
    )
    const statuswallCol = this.fixtureCol('statuswall')
    const wait: Tile = {
      x:
        underStation.length === 0
          ? nearestClearColumn(solid, yardSeatRow, statuswallCol)
          : underStation.reduce((best, x) =>
              Math.abs(x - statuswallCol) < Math.abs(best - statuswallCol) ? x : best
            ),
      y: yardSeatRow,
    }
    this.blockedForBelt.add(key(wait))
    return wait
  }

  /**
   * Breakroom: a room in the bottom band, centred on the median crewed
   * station column and clamped inside the hall, with a two-tile door in the
   * middle of its partition.
   */
  placeBreakroom(): { x: number; door: Tile[]; restSeats: RestSeat[] } {
    const { roomRow } = this.rows
    const roomX = this.roomX()
    const doorX = roomX + Math.floor(this.roomWidth / 2) - 1
    const door: Tile[] = [
      { x: doorX, y: roomRow },
      { x: doorX + 1, y: roomRow },
    ]
    fillRect(this.solid, [roomX, roomRow, this.roomWidth, 1], true)
    fillRect(this.solid, [roomX, roomRow, 1, BREAKROOM_ROWS], true)
    fillRect(this.solid, [roomX + this.roomWidth - 1, roomRow, 1, BREAKROOM_ROWS], true)
    for (const d of door) this.solid[d.y][d.x] = false
    this.props.push(
      decor('room-partition', 'partition', [roomX, roomRow, this.roomWidth, BREAKROOM_ROWS])
    )
    this.put('room-fridge', 'fridge', [roomX + 1, roomRow + 2])
    this.put('room-coffee', 'coffeebar', [roomX + 1, roomRow + 3])
    this.put('room-plant-l', 'plant', [roomX + 1, roomRow + 4])
    this.put('room-vending', 'vending', [roomX + this.roomWidth - 2, roomRow + 2])
    this.put('room-plant-r', 'plant', [roomX + this.roomWidth - 2, roomRow + 4])
    return { x: roomX, door, restSeats: this.placeRestModules(roomX) }
  }

  private roomX(): number {
    const crewedX = this.crewed
      .map((n) => {
        const stationProp = this.props.find((p) => p.nodeId === n.id) as HallProp
        return stationProp.x + Math.floor(stationProp.w / 2)
      })
      .sort((a, b) => a - b)
    const median =
      crewedX.length > 0 ? crewedX[Math.floor(crewedX.length / 2)] : Math.floor(this.width / 2)
    return Math.min(
      Math.max(median - Math.floor(this.roomWidth / 2), 1),
      this.width - 1 - this.roomWidth
    )
  }

  /** A piece of breakroom furniture, one tile unless it says otherwise. */
  private put(
    id: string,
    kind: PropKind,
    [x, y, w = 1, h = 1]: readonly [number, number, number?, number?]
  ): void {
    this.props.push(decor(id, kind, [x, y, w, h]))
    fillRect(this.solid, [x, y, w, h], true)
  }

  /** A bench or sofa, a table and a bench per module, with two seats on each seat row. */
  private placeRestModules(roomX: number): RestSeat[] {
    const { roomRow } = this.rows
    const restSeats: RestSeat[] = []
    const seat = (tile: Tile, facing: 'N' | 'S', propId: string): void => {
      restSeats.push({ id: restSeats.length, tile, facing, propId })
    }
    for (let m = 0; m < this.modules; m++) {
      const c = roomX + 4 + 3 * m
      const sofa = m % 2 === 1
      const topId = `room-top-${m}`
      const botId = `room-bot-${m}`
      this.put(topId, sofa ? 'sofa' : 'restbench', [c, roomRow + 2, 2, 1])
      this.put(`room-table-${m}`, sofa ? 'lowtable' : 'table', [c, roomRow + 3, 2, 1])
      this.put(botId, 'restbench', [c, roomRow + 4, 2, 1])
      for (const dx of [0, 1]) seat({ x: c + dx, y: roomRow + 2 }, 'S', topId)
      for (const dx of [0, 1]) seat({ x: c + dx, y: roomRow + 4 }, 'N', botId)
    }
    return restSeats
  }

  /** One light per ~6 columns, per belt row, plus one over the breakroom's near seat row. */
  lightsOver(roomX: number): Tile[] {
    const { rows } = this
    const lights: Tile[] = []
    const litRows = [
      rows.yardBeltRow,
      ...(rows.yardBands === 2 ? [rows.yardBeltRow + YARD_ROWS] : []),
      ...rows.laneValues.map((_, i) => rows.laneBandStart(i) + 2),
    ]
    for (const row of litRows) {
      for (let col = 3; col < this.width - 1; col += 6) lights.push({ x: col, y: row })
    }
    lights.push({ x: roomX + Math.floor(this.roomWidth / 2), y: rows.roomRow + 2 })
    return lights
  }

  /**
   * Belts: one routed path per `dependsOn` edge, sharing tiles only within a
   * split (same source) or merge (same target) group — and the walk grid over
   * them.
   */
  crossings(restSeats: readonly RestSeat[]): Crossings {
    const byNode = new Map(
      this.props.filter((p) => p.nodeId !== null).map((p) => [p.nodeId as string, p])
    )
    const routed = routeBelts(this.graph.nodes, byNode, {
      solid: this.solid,
      role: this.role,
      blockedForBelt: this.blockedForBelt,
      width: this.width,
      height: this.height,
      topWallRow: TOP_WALL_ROWS,
      roomRow: this.rows.roomRow,
    })
    return new Crossings(this, { routed, restSeats })
  }

  /** Moves a wall fixture over a column its user can reach, and returns where they stand. */
  standAtWall(kind: FixtureKind, reachedFromIntake: ReadonlyMap<string, number>): Tile {
    const others = new Set(FIXTURE_KINDS.filter((k) => k !== kind).map((k) => this.fixtureCol(k)))
    const preferred = this.fixtureCol(kind)
    const usable = (x: number): boolean =>
      x >= 1 &&
      x <= this.width - 2 &&
      !others.has(x) &&
      reachedFromIntake.has(key({ x, y: TOP_WALL_ROWS }))
    let x = preferred
    for (let offset = 0; offset < this.width; offset++) {
      if (usable(preferred + offset)) {
        x = preferred + offset
        break
      }
      if (usable(preferred - offset)) {
        x = preferred - offset
        break
      }
    }
    const index = this.props.findIndex((p) => p.id === `fixture-${kind}`)
    this.props[index] = { ...this.props[index], x }
    return { x, y: TOP_WALL_ROWS }
  }
}

/**
 * The walk grid over the belts, and the crossovers opened in it.
 *
 * Walk grid: solid ∪ belt tiles ∪ every seat. Crossovers open only where the
 * floor would otherwise split, or a station's walk to the breakroom door
 * detours badly around belts.
 */
class Crossings {
  readonly belts: readonly HallBelt[]
  readonly beltTiles: readonly BeltTile[]
  readonly walk: boolean[][]
  /** The walk grid with no belts at all: how far a walk would be if none were in the way. */
  private readonly free: boolean[][]
  readonly seatKeys: Set<string>
  private readonly stationKeys = new Set<string>()
  private readonly beltTileAt: Map<string, BeltTile>
  readonly crossovers: Tile[] = []

  constructor(
    hall: Pick<HallBuilder, 'props' | 'solid'>,
    { routed, restSeats }: { routed: RouteBeltsResult; restSeats: readonly RestSeat[] }
  ) {
    const { props, solid } = hall
    this.belts = routed.belts
    this.beltTiles = routed.beltTiles
    this.seatKeys = new Set<string>([
      ...props.filter((p) => p.seat !== null).map((p) => key(p.seat as Tile)),
      ...restSeats.map((s) => key(s.tile)),
    ])
    const behindStation = behindStations(props)
    this.beltTileAt = new Map(routed.beltTiles.map((t) => [key(t), t]))
    const covered = (x: number, y: number): boolean =>
      this.seatKeys.has(key({ x, y })) || behindStation.has(key({ x, y }))
    this.walk = solid.map((row, y) =>
      row.map((v, x) => v || this.beltTileAt.has(key({ x, y })) || covered(x, y))
    )
    this.free = solid.map((row, y) => row.map((v, x) => v || covered(x, y)))
    // A crossover must sit clear of every station, seat and belt junction,
    // so nobody crosses a belt while standing at a terminal.
    for (const p of props.filter((q) => q.nodeId !== null)) {
      for (let x = p.x; x < p.x + p.w; x++) {
        for (let y = p.y; y < p.y + p.h; y++) this.stationKeys.add(key({ x, y }))
      }
    }
  }

  private isPortOfSomeBelt(t: Tile): boolean {
    return this.belts.some((b) => {
      const first = b.path[0]
      const last = b.path[b.path.length - 1]
      return (
        (first !== undefined && key(first) === key(t)) ||
        (last !== undefined && key(last) === key(t))
      )
    })
  }

  isOpenableStraight(t: Tile): boolean {
    const tile = this.beltTileAt.get(key(t))
    return tile !== undefined && tile.kind === 'straight' && !this.isPortOfSomeBelt(t)
  }

  private open(t: Tile): void {
    this.walk[t.y][t.x] = false
    this.crossovers.push(t)
  }

  private isClear(t: Tile): boolean {
    return !nearAny(
      t,
      (k) =>
        this.stationKeys.has(k) ||
        this.seatKeys.has(k) ||
        ['split', 'merge', 'corner'].includes(this.beltTileAt.get(k)?.kind ?? '')
    )
  }

  private isHorizontal(t: Tile): boolean {
    const outs = (this.beltTileAt.get(key(t)) as BeltTile).outs
    return outs.includes('E') || outs.includes('W')
  }

  private isOpen(u: Tile): boolean {
    return this.walk[u.y]?.[u.x] !== true
  }

  private sidesOpen(t: Tile): readonly [Tile, Tile] | null {
    const [p, q] = sidesOf(t, this.isHorizontal(t))
    return this.isOpen(p) && this.isOpen(q) ? [p, q] : null
  }

  /** The tile after `t` along its belt's own axis, when it can be opened with it. */
  private partnerOf(t: Tile): Tile | null {
    if (!this.isOpenableStraight(t)) return null
    const next = this.isHorizontal(t) ? { x: t.x + 1, y: t.y } : { x: t.x, y: t.y + 1 }
    if (!this.isOpenableStraight(next) || this.isHorizontal(next) !== this.isHorizontal(t)) {
      return null
    }
    if (this.walk[next.y][next.x] !== true) return null
    return this.sidesOpen(t) !== null && this.sidesOpen(next) !== null ? next : null
  }

  /** Whether `t` can be opened as a crossover pair, clear of everything a crossing must avoid. */
  private pairsClear(t: Tile): boolean {
    const partner = this.partnerOf(t)
    return partner !== null && this.isClear(t) && this.isClear(partner)
  }

  /**
   * A crossover is a pair of neighbouring straight tiles of one belt, opened
   * together so two people can pass.
   */
  private openPair(t: Tile): void {
    const partner = this.partnerOf(t) as Tile
    this.open(t)
    this.open(partner)
  }

  /** Opens crossovers until every key in `requiredKeys` can be walked to from `intake`. */
  openUntilReachable(requiredKeys: readonly string[], intake: Tile): void {
    const required: Tile[] = requiredKeys.map(tileOfKey)
    const reachable = (seen: ReadonlySet<string>, t: Tile): boolean =>
      seen.has(key(t)) || NEIGHBOUR_STEPS.some((s) => seen.has(key({ x: t.x + s.x, y: t.y + s.y })))
    for (let guard = 0; guard < 50; guard++) {
      const seen = new Set(distancesFrom(this.walk, intake).keys())
      if (required.every((t) => reachable(seen, t))) break
      const candidates = this.splittingCandidates(seen)
      if (candidates.length === 0) break
      const pair = candidates.find((t) => this.pairsClear(t))
      if (pair !== undefined) this.openPair(pair)
      else this.open(candidates[0])
    }
  }

  /** Straight belt tiles with reached floor on one side and unreached floor on the other. */
  private splittingCandidates(seen: ReadonlySet<string>): Tile[] {
    return [...this.beltTileAt.keys()]
      .map(tileOfKey)
      .filter((t) => {
        if (!this.isOpenableStraight(t)) return false
        const tile = this.beltTileAt.get(key(t)) as BeltTile
        const horizontal = tile.outs.includes('E') || tile.outs.includes('W')
        const [p, q] = sidesOf(t, horizontal)
        return this.isOpen(p) && this.isOpen(q) && seen.has(key(p)) !== seen.has(key(q))
      })
      .sort((a, b) => a.y - b.y || a.x - b.x)
  }

  /** For every seat, opens up to three crossovers while its walk to the door detours badly. */
  openSeatWays(props: readonly HallProp[], doorTile: Tile): void {
    for (const p of props.filter((q) => q.seat !== null)) {
      for (let i = 0; i < 3; i++) {
        if (!this.openOnWay(p.seat as Tile, doorTile)) break
      }
    }
  }

  /** Opens one crossover on the seat's belt-free way to the door; false when there is nothing to do. */
  private openOnWay(seat: Tile, doorTile: Tile): boolean {
    const blockedLength = findPath(this.walk, { from: seat, to: doorTile }).length
    const freePath = findPath(this.free, { from: seat, to: doorTile })
    if (blockedLength > 0 && blockedLength <= freePath.length + 8) return false
    const onWay = freePath.filter((u) => this.walk[u.y][u.x] && this.isOpenableStraight(u))
    const clear = onWay.find((u) => this.pairsClear(u))
    if (clear !== undefined) {
      this.openPair(clear)
      return true
    }
    if (onWay.length === 0) return false
    this.open(onWay[0])
    return true
  }
}

/**
 * The row above a station is where its screens and nameplate are drawn, so a
 * crew member walking there disappears behind the station.
 */
function behindStations(props: readonly HallProp[]): Set<string> {
  const behind = new Set<string>()
  for (const p of props.filter((q) => q.nodeId !== null)) {
    for (let x = p.x; x < p.x + p.w; x++) behind.add(key({ x, y: p.y - 1 }))
  }
  return behind
}

function nearAny(t: Tile, near: (k: string) => boolean): boolean {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) if (near(key({ x: t.x + dx, y: t.y + dy }))) return true
  }
  return false
}

function tileOfKey(k: string): Tile {
  const [x, y] = k.split(',').map(Number)
  return { x, y }
}
