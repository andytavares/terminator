import type { HallMap, HallProp, PropKind, Side, BeltTile, Tile } from '../layout.js'
import { TILE_PX } from '../layout.js'
import type { Crew } from '../sim.js'
import type { NodeState } from '../../line/run-graph.js'
import type { Check } from '../../line/ci.js'
import type { Paint } from './kit.js'
import { rect, bevel, rivets, wear, mulberry32 } from './kit.js'
import { HALL, CODE_LINE_COLORS } from './palette.js'

// One draw function per `PropKind`, plus the floor/wall bake and the belts and
// crate that move over it.
//
// The honesty rule lives in what each function reads out of `SceneContext`:
// a desk's screens, a rig's waveform and a gate's beacon each ask "is a
// present crew member actually doing the thing that would light this up"
// rather than animating on a clock. Ambient decor (a plant's sway, a rack's
// idle blink) is the one exception — nothing about a run makes those true or
// false, so a clock is the only honest input they have. Breakroom furniture
// (a bench, a sofa, a table, a fridge, a coffeebar, a vending machine, a
// partition) is decor too: it never carries a `nodeId` and never reads
// `SceneContext` at all.

export interface SceneContext {
  readonly crew: readonly Crew[]
  readonly states: Readonly<Record<string, NodeState>>
  readonly gatesWaiting: readonly string[]
  /** The dispatch tower's own state: null until CI has something to show. */
  readonly ci?: { readonly checks: Readonly<Record<string, Check['bucket']>> } | null
  /**
   * This order's own numbers, for the status wall — null until there is a
   * metrics row to draw. `leadTimeMs` is null on its own until the order has
   * shipped, which the status wall reads as "nothing to show yet" rather than
   * zero.
   */
  readonly metrics?: {
    readonly leadTimeMs: number | null
    readonly reworks: number
    readonly ciRounds: number
  } | null
  /** This order's place in the refinery's file-overlap queue — null out of a queue. */
  readonly queue?: { readonly position: number } | null
}

/** Rows 0–2 are the top wall on every `HallMap` — see `layout.ts`'s contract. */
const TOP_WALL_ROWS = 3
const MINUTE_MS = 60_000

function typingAt(context: SceneContext, nodeId: string): boolean {
  return context.crew.some((c) => c.present && c.nodeId === nodeId && c.anim === 'type')
}

function scanningAt(context: SceneContext, nodeId: string): boolean {
  return context.crew.some((c) => c.present && c.nodeId === nodeId && c.anim === 'scan')
}

function hasPassed(context: SceneContext, nodeId: string | null): boolean {
  return nodeId !== null && context.states[nodeId] === 'passed'
}

function gateIsWaiting(context: SceneContext, nodeId: string | null): boolean {
  return nodeId !== null && context.gatesWaiting.includes(nodeId)
}

function chairOwnerNodeId(prop: HallProp): string | null {
  return prop.id.startsWith('chair-') ? prop.id.slice('chair-'.length) : null
}

const DIGIT_GLYPHS: Readonly<Record<string, readonly string[]>> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
}

function drawDigit(paint: Paint, x: number, y: number, digit: string, color: string): void {
  const rows = DIGIT_GLYPHS[digit]
  if (rows === undefined) return
  rows.forEach((row, j) => {
    for (let i = 0; i < 3; i++) {
      if (row[i] === '1') rect(paint, x + i * 2, y + j * 2, 2, 2, color)
    }
  })
}

/** A diagonal amber/dark hazard stripe, the floor decal before a press or a gate. */
function hazardHatch(paint: Paint, x: number, y: number, w: number, h: number): void {
  for (let i = 0; i < w + h; i += 4) {
    for (let j = 0; j < h; j++) {
      const xx = i - j
      if (xx >= 0 && xx < w && (xx + j) % 8 < 4) rect(paint, x + xx, y + j, 1, 1, HALL.amberDim)
    }
  }
}

function drawWhiteboard(paint: Paint, x: number, y: number): void {
  rect(paint, x, y, 48, 26, '#d9dde2')
  bevel(paint, x, y, 48, 26, '#f2f4f6', '#8a929c')
  const strokes: readonly [number, number, number, string][] = [
    [4, 6, 20, '#3c6fb0'],
    [4, 12, 14, '#b04a3c'],
    [22, 6, 18, '#3c6fb0'],
    [4, 18, 30, '#3a8a4a'],
  ]
  for (const [sx, sy, sw, color] of strokes) rect(paint, x + sx, y + sy, sw, 1, color)
}

function drawVendingMachine(paint: Paint, x: number, y: number): void {
  rect(paint, x, y, 14, 33, '#8a2f2a')
  bevel(paint, x, y, 14, 33, '#b04a3c', '#4a1512')
  rect(paint, x + 2, y + 3, 7, 18, '#10151a')
  const rowColors = [HALL.amber, HALL.cyan, HALL.green, '#e9ecef']
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 2; c++)
      rect(paint, x + 3 + c * 3, y + 4 + r * 4, 2, 2, rowColors[(r + c) % 4])
  }
  rect(paint, x + 10, y + 6, 2, 6, '#1a1d22')
  rect(paint, x + 2, y + 24, 9, 5, '#1a1d22')
}

function drawExtinguisherSign(paint: Paint, x: number, y: number): void {
  rect(paint, x, y, 4, 10, HALL.red)
  rect(paint, x + 1, y - 2, 2, 2, '#2a2f37')
  rect(paint, x + 1, y + 1, 2, 1, '#e9ecef')
  rect(paint, x + 8, y - 2, 10, 8, HALL.amber)
  rect(paint, x + 12, y - 1, 2, 4, '#1a1d22')
  rect(paint, x + 12, y + 4, 2, 1, '#1a1d22')
}

function paintFloorTile(paint: Paint, tx: number, ty: number): void {
  const px = tx * TILE_PX
  const py = ty * TILE_PX
  rect(paint, px, py, TILE_PX, TILE_PX, (tx + ty) % 2 === 0 ? HALL.plate2 : HALL.plate)
  bevel(paint, px, py, TILE_PX, TILE_PX, HALL.hi, HALL.seam)
  rivets(paint, px, py, TILE_PX, TILE_PX, HALL.rivet)
  wear(paint, px, py, TILE_PX, TILE_PX, tx * 131 + ty * 977, HALL.wear)
}

/**
 * Floor plates, the four walls with their door gaps, and the breakroom's own
 * floor, rug and door threshold. Deterministic: no `tMs`.
 */
export function bakeHall(map: HallMap, paint: Paint): void {
  const w = map.width * TILE_PX
  const faceH = (TOP_WALL_ROWS - 1) * TILE_PX

  for (let y = TOP_WALL_ROWS; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) paintFloorTile(paint, x, y)
  }

  // The hazard hatch on the floor tile before every press or gate — a floor
  // decal, so it bakes once.
  for (const prop of map.props) {
    if (prop.kind !== 'press' && prop.kind !== 'gate') continue
    hazardHatch(paint, (prop.x - 1) * TILE_PX, prop.y * TILE_PX, TILE_PX, prop.h * TILE_PX)
  }

  // A lane number stencil at the left edge of every lane's belt row.
  for (const lane of map.lanes) {
    const digit = lane.label.match(/\d+/)?.[0]
    if (digit === undefined) continue
    drawDigit(paint, 1 * TILE_PX + 4, lane.row * TILE_PX + 3, digit, '#5a4e32')
  }

  rect(paint, 0, 0, w, TILE_PX, HALL.wallTop)
  rect(paint, 0, TILE_PX, w, faceH, HALL.wallFace)
  bevel(paint, 0, TILE_PX, w, faceH, HALL.wallTrim, '#1a1e25')
  for (let wx = 0; wx < w; wx += 32) rect(paint, wx, TILE_PX + 4, 1, faceH - 8, HALL.wallPanel)

  // Decorative wall furniture that never functions as a station: a
  // whiteboard, a vending machine and an extinguisher/sign, spread across
  // the wall independent of the interactive fixtures.
  drawWhiteboard(paint, Math.round(w * 0.08), TILE_PX + 4)
  drawVendingMachine(paint, Math.round(w * 0.62), TILE_PX + 16)
  drawExtinguisherSign(paint, Math.round(w * 0.94), TILE_PX + 20)

  for (let y = TOP_WALL_ROWS; y < map.height - 1; y++) {
    const isIntake = y === map.anchors.intake.y
    const isExit = y === map.anchors.exit.y
    rect(paint, 0, y * TILE_PX, TILE_PX, TILE_PX, isIntake ? HALL.door : HALL.wallTop)
    rect(
      paint,
      (map.width - 1) * TILE_PX,
      y * TILE_PX,
      TILE_PX,
      TILE_PX,
      isExit ? HALL.door : HALL.wallTop
    )
  }

  rect(paint, 0, (map.height - 1) * TILE_PX, w, TILE_PX, HALL.wallTrim)

  // The breakroom's own floor, rug and door threshold — ported verbatim
  // from the prototype's `bakeHall2` tail, reading `map.breakroom` in place
  // of its `room`.
  const r = map.breakroom
  for (let y = r.y + 1; y < r.y + r.h; y++) {
    for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
      rect(paint, x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX, (x + y) % 2 ? '#4a4038' : '#524740')
      rect(paint, x * TILE_PX, y * TILE_PX + 15, TILE_PX, 1, '#3a322b')
      rect(paint, x * TILE_PX + 15, y * TILE_PX, 1, TILE_PX, '#3a322b')
    }
  }
  rect(
    paint,
    (r.x + 3) * TILE_PX + 4,
    (r.y + 2) * TILE_PX + 2,
    (r.w - 6) * TILE_PX + 8,
    3 * TILE_PX - 4,
    '#3a2f3a'
  )
  for (let x = (r.x + 3) * TILE_PX + 6; x < (r.x + r.w - 3) * TILE_PX + 10; x += 6) {
    rect(paint, x, (r.y + 2) * TILE_PX + 4, 2, 1, '#524252')
    rect(paint, x, (r.y + 5) * TILE_PX - 5, 2, 1, '#524252')
  }
  for (const d of r.door) {
    rect(paint, d.x * TILE_PX, d.y * TILE_PX, TILE_PX, TILE_PX, '#524740')
    rect(paint, d.x * TILE_PX, d.y * TILE_PX + 6, TILE_PX, 3, HALL.amberDim)
  }
}

const BED = '#15181d'
const TREAD = '#2b3038'
const RAIL = HALL.steelLight
const RAIL_LO = '#0a0c0f'
const WOOD = '#6e5238'
const WOOD_HI = '#8a6a4a'
const WOOD_LO = '#4a3624'

/** Bed rectangle for the hub (3..12) plus an arm to each connected side. */
function bedParts(sides: ReadonlySet<Side>): [number, number, number, number][] {
  const parts: [number, number, number, number][] = [[3, 3, 10, 10]]
  if (sides.has('N')) parts.push([3, 0, 10, 3])
  if (sides.has('S')) parts.push([3, 13, 10, 3])
  if (sides.has('W')) parts.push([0, 3, 3, 10])
  if (sides.has('E')) parts.push([13, 3, 3, 10])
  return parts
}

function rails(paint: Paint, x: number, y: number, sides: ReadonlySet<Side>): void {
  // A rail runs along every edge of the bed that is not an opening.
  const r = (a: number, b: number, w: number, h: number): void =>
    rect(paint, x + a, y + b, w, h, RAIL)
  if (!sides.has('N')) r(2, 2, 12, 1)
  if (!sides.has('S')) {
    r(2, 13, 12, 1)
    rect(paint, x + 2, y + 14, 12, 1, RAIL_LO)
  }
  if (!sides.has('W')) r(2, 2, 1, 12)
  if (!sides.has('E')) r(13, 2, 1, 12)
  if (sides.has('N')) {
    r(2, 0, 1, 3)
    r(13, 0, 1, 3)
  }
  if (sides.has('S')) {
    r(2, 13, 1, 3)
    r(13, 13, 1, 3)
  }
  if (sides.has('W')) {
    r(0, 2, 3, 1)
    r(0, 13, 3, 1)
  }
  if (sides.has('E')) {
    r(13, 2, 3, 1)
    r(13, 13, 3, 1)
  }
}

function chevron(paint: Paint, cx: number, cy: number, d: Side, color: string): void {
  const pts: Record<Side, [number, number][]> = {
    E: [
      [-1, -2],
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 2],
    ],
    W: [
      [1, -2],
      [0, -1],
      [-1, 0],
      [0, 1],
      [1, 2],
    ],
    S: [
      [-2, -1],
      [-1, 0],
      [0, 1],
      [1, 0],
      [2, -1],
    ],
    N: [
      [-2, 1],
      [-1, 0],
      [0, -1],
      [1, 0],
      [2, 1],
    ],
  }
  for (const [dx, dy] of pts[d]) rect(paint, cx + dx, cy + dy, 1, 1, color)
}

function treads(paint: Paint, x: number, y: number, d: Side, offset: number): void {
  const horiz = d === 'E' || d === 'W'
  const sign = d === 'E' || d === 'S' ? 1 : -1
  for (let i = 0; i < 16; i += 4) {
    const p = (i + sign * offset + 16) % 16
    if (horiz) rect(paint, x + p, y + 4, 1, 8, TREAD)
    else rect(paint, x + 4, y + p, 8, 1, TREAD)
  }
}

/** One belt tile: its bed, rails, direction chevron and — on a crossing — the raised deck. */
function drawBeltTile(
  paint: Paint,
  tx: number,
  ty: number,
  tile: BeltTile,
  moving: boolean,
  tMs: number
): void {
  const x = tx * TILE_PX
  const y = ty * TILE_PX
  const sides = new Set<Side>([...tile.ins, ...tile.outs])
  const offset = moving ? Math.floor(tMs / 70) % 4 : 0
  for (const [a, b, w, h] of bedParts(sides)) rect(paint, x + a, y + b, w, h, BED)
  const out = tile.outs[0]
  if (tile.kind === 'straight' || tile.kind === 'corner') {
    treads(paint, x, y, out, offset)
    rails(paint, x, y, sides)
    if (tile.kind === 'corner') {
      rect(paint, x + 6, y + 6, 4, 4, '#20252c')
      rect(paint, x + 7, y + 7, 2, 2, HALL.steelDark)
    }
    chevron(paint, x + 8, y + 8, out, HALL.amberDim)
  } else {
    // Junction: a turntable in the hub — amber diverter for a split, steel for a merge.
    rails(paint, x, y, sides)
    const disc = tile.kind === 'split' ? HALL.amber : HALL.steel
    rect(paint, x + 4, y + 5, 8, 6, disc)
    rect(paint, x + 5, y + 4, 6, 8, disc)
    rect(paint, x + 6, y + 6, 4, 4, tile.kind === 'split' ? HALL.amberDim : HALL.steelDark)
    const chevronOffset: Record<Side, [number, number]> = {
      E: [5, 0],
      W: [-5, 0],
      N: [0, -5],
      S: [0, 5],
    }
    for (const d of tile.outs) {
      const [ox, oy] = chevronOffset[d]
      chevron(paint, x + 8 + ox, y + 8 + oy, d, HALL.amber)
    }
  }
  if (tile.kind === 'cross' && tile.over !== null) {
    // The crossing belt rides over on a raised deck.
    const { from: a, to: b } = tile.over
    const horiz = a === 'E' || a === 'W'
    if (horiz) {
      rect(paint, x, y + 2, 16, 12, '#20252c')
      rect(paint, x, y + 1, 16, 1, HALL.steelLight)
      rect(paint, x, y + 14, 16, 1, RAIL_LO)
      treads(paint, x, y, b, offset)
    } else {
      rect(paint, x + 2, y, 12, 16, '#20252c')
      rect(paint, x + 1, y, 1, 16, HALL.steelLight)
      rect(paint, x + 14, y, 1, 16, RAIL_LO)
      treads(paint, x, y, b, offset)
    }
    chevron(paint, x + 8, y + 8, b, HALL.amberDim)
  }
}

/** A steel step-over plate with hazard edges, spanning the belt at right angles to its flow. */
function drawCrossover(paint: Paint, tx: number, ty: number, tile: BeltTile): void {
  const x = tx * TILE_PX
  const y = ty * TILE_PX
  const horizBelt = tile.outs.includes('E') || tile.outs.includes('W')
  if (horizBelt) {
    rect(paint, x + 3, y, 10, 16, HALL.steelDark)
    bevel(paint, x + 3, y, 10, 16, HALL.steelLight, '#262b33')
    for (let i = 0; i < 16; i += 4) rect(paint, x + 3, y + i, 10, 1, '#4a525e')
    for (let i = 0; i < 16; i += 4) {
      rect(paint, x + 2, y + i, 1, 2, HALL.amber)
      rect(paint, x + 13, y + i + 2, 1, 2, HALL.amber)
    }
  } else {
    rect(paint, x, y + 3, 16, 10, HALL.steelDark)
    bevel(paint, x, y + 3, 16, 10, HALL.steelLight, '#262b33')
    for (let i = 0; i < 16; i += 4) rect(paint, x + i, y + 3, 1, 10, '#4a525e')
    for (let i = 0; i < 16; i += 4) {
      rect(paint, x + i, y + 2, 2, 1, HALL.amber)
      rect(paint, x + i + 2, y + 13, 2, 1, HALL.amber)
    }
  }
}

/** Every belt tile, then every crossover's step-over plate on top of it. */
export function drawBelts(
  paint: Paint,
  map: HallMap,
  movingBeltIds: ReadonlySet<string>,
  tMs: number
): void {
  const movingTiles = new Set(
    map.belts
      .filter((b) => movingBeltIds.has(b.id))
      .flatMap((b) => b.path.map((t) => `${t.x},${t.y}`))
  )
  const tileAt = new Map(map.beltTiles.map((t) => [`${t.x},${t.y}`, t]))
  for (const tile of map.beltTiles) {
    const key = `${tile.x},${tile.y}`
    drawBeltTile(paint, tile.x, tile.y, tile, movingTiles.has(key), tMs)
  }
  for (const t of map.crossovers) {
    const tile = tileAt.get(`${t.x},${t.y}`)
    if (tile !== undefined) drawCrossover(paint, t.x, t.y, tile)
  }
}

export function drawCrate(paint: Paint, x: number, y: number): void {
  rect(paint, x - 5, y - 8, 10, 10, '#b07a3c')
  rect(paint, x - 5, y - 8, 10, 3, '#c99452')
  rect(paint, x - 1, y - 8, 2, 10, '#d8c38e')
}

function drawScreen(
  paint: Paint,
  x: number,
  y: number,
  w: number,
  h: number,
  lit: boolean,
  tMs: number,
  seed: number
): void {
  rect(paint, x - 1, y - 1, w + 2, h + 2, '#14171c')
  rect(paint, x, y, w, h, lit ? HALL.screenOn : HALL.screenOff)
  if (!lit) {
    rect(paint, x + 1, y + 1, 2, 1, '#1c222a')
    return
  }
  const t = tMs / 1000
  const off = Math.floor(t * 6 + seed * 5)
  const rows = Math.floor(h / 2)
  for (let r = 0; r < rows; r++) {
    const shift = (r + off) % 3
    const len = 2 + ((r * 7 + off * 3 + seed * 11) % Math.max(w - 3, 1))
    const lineW = Math.max(1, Math.min(len, w - 2 - shift))
    rect(
      paint,
      x + 1 + shift,
      y + 1 + r * 2,
      lineW,
      1,
      CODE_LINE_COLORS[(r + off + seed) % CODE_LINE_COLORS.length]
    )
  }
}

function drawDesk(paint: Paint, prop: HallProp, context: SceneContext, tMs: number): void {
  const x = prop.x * TILE_PX
  const y = prop.y * TILE_PX
  const w = prop.w * TILE_PX
  const lit = prop.nodeId !== null && typingAt(context, prop.nodeId)

  rect(paint, x + 1, y + 3, w - 2, 9, HALL.deskTop)
  bevel(paint, x + 1, y + 3, w - 2, 9, HALL.deskEdge, HALL.deskFace)
  rect(paint, x + 1, y + 12, w - 2, 4, HALL.deskFace)
  rect(paint, x + 2, y + 13, 2, 3, '#2a2f37')
  rect(paint, x + w - 4, y + 13, 2, 3, '#2a2f37')

  const screenCount = prop.w >= 3 ? 3 : 2
  const screenW = Math.floor((w - 6) / screenCount)
  for (let i = 0; i < screenCount; i++) {
    const sx = x + 3 + i * (screenW + 1)
    drawScreen(paint, sx, y - 8, screenW, 9, lit, tMs, i + prop.x)
    rect(paint, sx + Math.floor(screenW / 2) - 1, y + 1, 2, 3, '#2a2f37')
  }

  // Keyboard, a stack of papers and a mug — desk clutter that never moves.
  rect(paint, x + Math.floor(w / 2) - 6, y + 8, 12, 3, '#262b33')
  for (let k = 0; k < 5; k++) rect(paint, x + Math.floor(w / 2) - 5 + k * 2, y + 9, 1, 1, '#434a55')
  rect(paint, x + 4, y + 7, 3, 4, '#d9dde2')
  rect(paint, x + 5, y + 8, 2, 1, '#9aa2ac')
  rect(paint, x + w - 7, y + 6, 3, 3, '#b8574a')
  rect(paint, x + w - 7, y + 6, 3, 1, '#d06a5b')

  if (prop.nodeId !== null) {
    rect(paint, x + w - 4, y, 3, 2, hasPassed(context, prop.nodeId) ? HALL.green : '#3a414b')
  }
}

function drawRig(paint: Paint, prop: HallProp, context: SceneContext, tMs: number): void {
  const x = prop.x * TILE_PX
  const y = prop.y * TILE_PX
  const w = prop.w * TILE_PX
  const scanning = prop.nodeId !== null && scanningAt(context, prop.nodeId)

  rect(paint, x + 1, y - 6, w - 2, 21, HALL.steelDark)
  bevel(paint, x + 1, y - 6, w - 2, 21, HALL.steelLight, '#262b33')
  rect(paint, x + 3, y - 4, w - 5, 10, '#101418')

  if (scanning) {
    const t = tMs / 1000
    for (let i = 0; i < w - 6; i++) {
      const v = Math.round(Math.sin(i * 0.9 + t * 9) * 3)
      rect(paint, x + 4 + i, y + 1 + v, 1, 1, HALL.green)
    }
  } else {
    rect(paint, x + 4, y + 1, w - 6, 1, '#1f3325')
  }

  // Probe ports along the base — a rig is a bench with cables, not a screen alone.
  rect(paint, x + 2, y + 8, w - 4, 3, '#20252c')
  for (let p = 0; p < 3; p++) {
    rect(paint, x + 3 + p * 3, y + 12, 1, 6, ['#b04a3c', '#e0a13a', '#3a6ea1'][p])
  }

  if (prop.nodeId !== null) {
    rect(paint, x + w - 5, y - 9, 3, 3, hasPassed(context, prop.nodeId) ? HALL.green : '#3a414b')
  }
}

function drawBench(paint: Paint, prop: HallProp, context: SceneContext, tMs: number): void {
  const x = prop.x * TILE_PX
  const y = prop.y * TILE_PX
  const w = prop.w * TILE_PX
  const scanning = prop.nodeId !== null && scanningAt(context, prop.nodeId)

  rect(paint, x, y - 2, w, 14, HALL.deskFace)
  bevel(paint, x, y - 2, w, 14, HALL.deskEdge, '#1c2026')
  rect(paint, x + 2, y - 8, w - 4, 8, '#1a1f26')

  if (scanning) {
    const t = tMs / 1000
    const sweep = Math.floor(((Math.sin(t * 4) + 1) / 2) * Math.max(w - 8, 1))
    rect(paint, x + 3 + sweep, y - 7, 2, 6, HALL.cyan)
  }

  if (prop.nodeId !== null) {
    rect(paint, x + w - 5, y - 10, 3, 3, hasPassed(context, prop.nodeId) ? HALL.green : '#3a414b')
  }
}

/** The press is the biggest machine on the floor — the lanes converge here. */

function drawPress(paint: Paint, prop: HallProp, context: SceneContext, tMs: number): void {
  const x = prop.x * TILE_PX
  const y = prop.y * TILE_PX
  const w = prop.w * TILE_PX
  // One tile of headroom above the footprint, so the machine stands tall
  // without reaching into the wall face behind it.
  const top = y - TILE_PX
  const PRESS_VISUAL_H = (prop.h + 1) * TILE_PX - 14
  const active = prop.nodeId !== null && typingAt(context, prop.nodeId)

  rect(paint, x, top, w, PRESS_VISUAL_H + 10, HALL.steel)
  bevel(paint, x, top, w, PRESS_VISUAL_H + 10, HALL.steelLight, HALL.steelDark)
  rect(paint, x + 2, top + 4, 4, PRESS_VISUAL_H, '#2a3039')
  rect(paint, x + w - 6, top + 4, 4, PRESS_VISUAL_H, '#2a3039')
  // hazard stripes down both guard rails
  for (let i = 0; i < PRESS_VISUAL_H; i += 6) {
    rect(paint, x + 2, top + 4 + i, 4, 3, i % 12 === 0 ? HALL.amber : '#1b1f26')
    rect(paint, x + w - 6, top + 4 + i, 4, 3, i % 12 === 0 ? HALL.amber : '#1b1f26')
  }

  const cycle = active ? Math.abs(Math.sin((tMs / 1000) * 3)) : 0
  const headY = top + 24 + Math.round(cycle * (PRESS_VISUAL_H - 40))
  rect(paint, x + 8, top + 8, w - 16, headY - top, '#262b33')
  rect(paint, x + 7, headY, w - 14, 10, '#6b7482')
  rect(paint, x + 7, headY, w - 14, 2, '#98a2b2')

  if (prop.nodeId !== null) {
    const beacon = hasPassed(context, prop.nodeId) ? HALL.green : active ? HALL.amber : '#2c323c'
    rect(paint, x + w / 2 - 2, top - 4, 4, 3, beacon)
  }
}

function drawGate(paint: Paint, prop: HallProp, context: SceneContext, tMs: number): void {
  const x = prop.x * TILE_PX
  const y = prop.y * TILE_PX
  const waiting = gateIsWaiting(context, prop.nodeId)
  const open = hasPassed(context, prop.nodeId)

  // Two posts, so the arm has something to swing between.
  rect(paint, x, y - 24, 4, 40, HALL.steel)
  bevel(paint, x, y - 24, 4, 40, HALL.steelLight, HALL.steelDark)
  rect(paint, x + TILE_PX - 4, y - 24, 4, 40, HALL.steel)
  bevel(paint, x + TILE_PX - 4, y - 24, 4, 40, HALL.steelLight, HALL.steelDark)

  const flashOn = Math.floor(tMs / 250) % 2 === 0
  const beacon = waiting ? (flashOn ? HALL.amber : HALL.amberDim) : open ? HALL.green : '#3a414b'
  rect(paint, x + 1, y - 30, TILE_PX - 2, 5, beacon)

  if (open) {
    // Arm raised, resting against the left post.
    rect(paint, x, y - 20, 2, 16, '#e9ecef')
    for (let s = 0; s < 3; s++) rect(paint, x, y - 18 + s * 5, 2, 2, HALL.red)
  } else {
    // Arm lowered, barring the lane.
    rect(paint, x + 1, y - 4, TILE_PX - 2, 3, '#e9ecef')
    for (let s = 0; s < 3; s++) rect(paint, x + 2 + s * 4, y - 4, 2, 3, HALL.red)
  }
}

const SHELF_BOOK_COLORS = [
  '#a14a3a',
  '#3a6ea1',
  '#d0a040',
  '#4a8a5a',
  '#7a5aa0',
  '#c9ccd1',
  '#2f4f6f',
]

function drawShelves(paint: Paint, prop: HallProp): void {
  const x = prop.x * TILE_PX
  const y = prop.y * TILE_PX
  const w = prop.w * TILE_PX

  rect(paint, x, y - 18, w, 33, '#3a3027')
  bevel(paint, x, y - 18, w, 33, '#5a4a3a', '#1d1814')

  const rnd = mulberry32(prop.x * 97 + 3)
  for (let s = 0; s < 3; s++) {
    const sy = y - 16 + s * 10
    rect(paint, x + 1, sy + 8, w - 2, 1, '#241d17')
    let bx = x + 2
    while (bx < x + w - 3) {
      const bw = 2 + Math.floor(rnd() * 2)
      const bh = 5 + Math.floor(rnd() * 3)
      rect(
        paint,
        bx,
        sy + 8 - bh,
        bw,
        bh,
        SHELF_BOOK_COLORS[Math.floor(rnd() * SHELF_BOOK_COLORS.length)]
      )
      bx += bw + (rnd() < 0.15 ? 2 : 0)
    }
  }
}

function drawRacks(paint: Paint, prop: HallProp, tMs: number): void {
  const x = prop.x * TILE_PX
  const y = prop.y * TILE_PX
  const t = tMs / 1000

  for (let i = 0; i < prop.w; i++) {
    const rx = x + i * TILE_PX + 1
    rect(paint, rx, y - 18, 14, 33, '#1b1f26')
    bevel(paint, rx, y - 18, 14, 33, HALL.steelDark, '#0e1014')
    for (let u = 0; u < 7; u++) {
      const uy = y - 16 + u * 4
      rect(paint, rx + 2, uy, 10, 3, '#2c323c')
      const blink = (Math.floor(t * (3 + ((i * 7 + u) % 5))) + u + i) % 4
      rect(paint, rx + 3, uy + 1, 1, 1, blink ? HALL.green : '#1e4a2a')
      rect(paint, rx + 5, uy + 1, 1, 1, (blink + u) % 3 ? HALL.amber : '#4a3515')
    }
  }
}

function drawStatuswall(paint: Paint, prop: HallProp, context: SceneContext): void {
  const x = prop.x * TILE_PX
  const y = prop.y * TILE_PX
  const w = prop.w * TILE_PX

  rect(paint, x, y - 20, w, 20, '#15181e')
  rect(paint, x + 2, y - 18, w - 4, 16, '#0a1a20')

  const values = Object.values(context.states)
  const passedCount = values.filter((s) => s === 'passed').length
  const total = Math.max(values.length, 1)
  const filled = Math.round((passedCount / total) * (w - 4))
  rect(paint, x + 2, y - 4, filled, 2, HALL.green)
  rect(paint, x + 2 + filled, y - 4, w - 4 - filled, 2, '#1d3440')

  const metrics = context.metrics
  if (metrics == null) return

  // Minutes to ship, reworks, CI rounds — three digit readouts along the
  // wall, in the order's own numbers. Minutes is skipped, not zeroed, while
  // the order has not shipped: a run that has not shipped has no lead time,
  // and zero would claim it shipped instantly.
  const minutes = metrics.leadTimeMs === null ? null : Math.round(metrics.leadTimeMs / MINUTE_MS)
  const readouts: readonly [number | null, string][] = [
    [minutes, HALL.cyan],
    [metrics.reworks, HALL.red],
    [metrics.ciRounds, HALL.amber],
  ]
  let dx = x + 3
  for (const [value, color] of readouts) {
    if (value === null) continue
    for (const digit of String(Math.min(Math.max(value, 0), 99))) {
      drawDigit(paint, dx, y - 14, digit, color)
      dx += 7
    }
    dx += 4
  }
}

function lampColor(bucket: Check['bucket']): string {
  switch (bucket) {
    case 'pass':
      return HALL.green
    case 'fail':
    case 'cancel':
      return HALL.red
    case 'pending':
    case 'skipping':
      return HALL.amber
    /* v8 ignore next 3 -- exhaustive union, unreachable */
    default: {
      const never: never = bucket
      throw new Error(`unhandled check bucket: ${String(never)}`)
    }
  }
}

/** A small tower beside the exit, one lamp per check the ship tail is watching. */
function drawDispatch(paint: Paint, prop: HallProp, context: SceneContext): void {
  const x = prop.x * TILE_PX
  const y = prop.y * TILE_PX

  rect(paint, x + 3, y - 24, 10, 24, '#20242c')
  bevel(paint, x + 3, y - 24, 10, 24, '#3a414d', '#12151b')

  const buckets = Object.values(context.ci?.checks ?? {})
  buckets.forEach((bucket, index) => {
    const ly = y - 21 + index * 5
    if (ly < y - 24) return
    rect(paint, x + 5, ly, 6, 3, lampColor(bucket))
  })
}

/**
 * A small amber plaque beside the exit, showing the position this order
 * holds in the refinery's file-overlap queue — flashing, the way a gate's
 * beacon flashes while it waits, for as long as `context.queue` says there is
 * one. Nothing here spells out the ordinal's letters: the hall's pixel font
 * only has digits, so the plaque shows the number and leans on its flash and
 * its place at the exit to say what it means.
 */
export function drawQueuePlate(paint: Paint, exit: Tile, context: SceneContext, tMs: number): void {
  const queue = context.queue ?? null
  if (queue === null) return
  const x = exit.x * TILE_PX
  const y = exit.y * TILE_PX
  const flashOn = Math.floor(tMs / 250) % 2 === 0

  rect(paint, x - 18, y - 40, 16, 12, '#20242c')
  bevel(paint, x - 18, y - 40, 16, 12, HALL.steelLight, HALL.steelDark)
  rect(paint, x - 16, y - 38, 12, 8, flashOn ? HALL.amber : HALL.amberDim)

  const digits = String(Math.max(queue.position, 0))
  let dx = x - 15 + Math.max(0, (12 - digits.length * 7) / 2)
  for (const digit of digits) {
    drawDigit(paint, dx, y - 36, digit, '#1a1508')
    dx += 7
  }
}

function drawLockers(paint: Paint, prop: HallProp): void {
  const x = prop.x * TILE_PX
  const y = prop.y * TILE_PX

  for (let i = 0; i < prop.w * 2; i++) {
    const lx = x + i * 8
    rect(paint, lx, y - 16, 8, 31, '#44607a')
    bevel(paint, lx, y - 16, 8, 31, '#6a87a2', '#2c4053')
    rect(paint, lx + 5, y - 2, 1, 3, '#b8c2cc')
  }
}

function drawPlant(paint: Paint, prop: HallProp, tMs: number): void {
  const x = prop.x * TILE_PX
  const y = prop.y * TILE_PX
  const sway = Math.round(Math.sin(tMs / 1000 + prop.x) * 0.6)

  rect(paint, x + 4, y + 6, 8, 8, HALL.pot)
  bevel(paint, x + 4, y + 6, 8, 8, '#8a6248', '#4d3626')
  const leaves: readonly [number, number, number, number][] = [
    [7, -6, 2, 12],
    [3, -2, 4, 3],
    [10, -4, 4, 3],
    [5, -9, 3, 4],
  ]
  leaves.forEach(([lx, ly, lw, lh], i) => {
    rect(paint, x + lx + (i % 2 ? sway : 0), y + ly, lw, lh, i % 3 ? HALL.leaf : HALL.leafDark)
  })
}

function drawChair(paint: Paint, prop: HallProp, context: SceneContext): void {
  const x = prop.x * TILE_PX
  const y = prop.y * TILE_PX
  const owner = chairOwnerNodeId(prop)
  const occupied = owner !== null && typingAt(context, owner)

  rect(paint, x + 5, y + 13, 6, 1, '#1c2026')
  rect(paint, x + 7, y + 10, 2, 4, '#2a2f37')
  if (occupied) return
  rect(paint, x + 3, y + 6, 10, 5, '#3a4150')
  bevel(paint, x + 3, y + 6, 10, 5, '#4b5466', '#1c2026')
  rect(paint, x + 4, y, 8, 7, '#343b49')
}

/**
 * The breakroom's partition: two side walls, a half wall with glazing along
 * the top broken by the door, a door frame and a mug-plaque sign above it.
 * The door columns come from the prop's own footprint — `x + floor(w/2) − 1`
 * and the tile beside it — the same pair `layoutHall` cuts through the wall.
 */
function partition(paint: Paint, prop: HallProp): void {
  const x0 = prop.x * TILE_PX
  const y0 = prop.y * TILE_PX
  const w = prop.w * TILE_PX
  const h = prop.h * TILE_PX
  const doorCol0 = prop.x + Math.floor(prop.w / 2) - 1
  const doors = new Set([doorCol0, doorCol0 + 1])

  // Side walls: thin, inset against the room.
  for (const sx of [x0 + 10, x0 + w - 16]) {
    rect(paint, sx, y0 - 6, 6, h + 6, HALL.wallFace)
    bevel(paint, sx, y0 - 6, 6, h + 6, HALL.wallTrim, '#1a1e25')
  }
  // Top: a half wall with glazing, broken by the door.
  for (let i = 0; i < prop.w; i++) {
    const x = x0 + i * TILE_PX
    if (doors.has(prop.x + i)) continue
    rect(paint, x, y0 + 4, 16, 10, HALL.wallFace)
    rect(paint, x, y0 + 4, 16, 1, HALL.wallTrim)
    rect(paint, x, y0 + 13, 16, 1, '#1a1e25')
    rect(paint, x, y0 - 12, 16, 16, 'rgba(114,216,242,.16)')
    rect(paint, x, y0 - 13, 16, 1, HALL.wallTrim)
    rect(paint, x + 3, y0 - 10, 1, 6, 'rgba(255,255,255,.25)')
    if (i % 2 === 0) rect(paint, x + 15, y0 - 12, 1, 16, HALL.wallTrim)
  }
  const dx = doorCol0 * TILE_PX
  rect(paint, dx - 2, y0 - 16, 2, 30, HALL.steel)
  rect(paint, dx + 32, y0 - 16, 2, 30, HALL.steel)
  rect(paint, dx - 2, y0 - 17, 36, 2, HALL.steel)
  // Sign: a mug on a plaque.
  rect(paint, dx + 9, y0 - 28, 14, 10, '#1a1e25')
  bevel(paint, dx + 9, y0 - 28, 14, 10, HALL.wallTrim, '#0d1015')
  rect(paint, dx + 12, y0 - 25, 6, 5, '#e9ecef')
  rect(paint, dx + 18, y0 - 24, 2, 3, '#e9ecef')
  rect(paint, dx + 13, y0 - 27, 1, 1, '#9aa2ac')
  rect(paint, dx + 16, y0 - 27, 1, 1, '#9aa2ac')
}

/** A wooden bench: a seat slab, two legs and a floor shadow. */
function benchS(paint: Paint, x: number, y: number, w: number): void {
  rect(paint, x + 1, y + 4, w - 2, 5, WOOD)
  bevel(paint, x + 1, y + 4, w - 2, 5, WOOD_HI, WOOD_LO)
  rect(paint, x + 3, y + 9, 2, 5, WOOD_LO)
  rect(paint, x + w - 5, y + 9, 2, 5, WOOD_LO)
  rect(paint, x + 2, y + 14, w - 4, 1, 'rgba(0,0,0,.3)')
}

/** A two-cushion sofa: a back cushion, a seat cushion and two arms. */
function sofa(paint: Paint, x: number, y: number, w: number): void {
  rect(paint, x, y - 3, w, 9, '#3f5a6e')
  bevel(paint, x, y - 3, w, 9, '#56768e', '#2a3c4a')
  rect(paint, x, y + 5, w, 8, '#4a6a82')
  bevel(paint, x, y + 5, w, 8, '#5f84a0', '#2a3c4a')
  rect(paint, x + w / 2, y + 6, 1, 6, '#2a3c4a')
  rect(paint, x - 1, y + 1, 3, 12, '#35505f')
  rect(paint, x + w - 2, y + 1, 3, 12, '#35505f')
}

/** A table, low (a coffee table) or standard height, with a mug and a plate fixed per table. */
function table(paint: Paint, x: number, y: number, w: number, low: boolean, seed: number): void {
  const top = low ? 5 : 1
  rect(paint, x + 2, y + top, w - 4, 8, low ? WOOD : '#c9ccd1')
  bevel(paint, x + 2, y + top, w - 4, 8, low ? WOOD_HI : '#e9ecef', low ? WOOD_LO : '#8a929c')
  rect(paint, x + 4, y + top + 8, 2, 16 - top - 9, '#2a2f37')
  rect(paint, x + w - 6, y + top + 8, 2, 16 - top - 9, '#2a2f37')
  rect(paint, x + 7 + (seed % 3) * 3, y + top + 2, 3, 3, '#e9ecef')
  rect(paint, x + w - 12, y + top + 3, 3, 3, '#b8574a')
  if (!low) {
    rect(paint, x + 12, y + top + 2, 6, 4, '#e9ecef')
    rect(paint, x + 13, y + top + 3, 4, 2, '#d0a040')
  }
}

function drawFridge(paint: Paint, prop: HallProp): void {
  const x = prop.x * TILE_PX
  const y = prop.y * TILE_PX
  rect(paint, x + 1, y - 16, 14, 31, '#c9ccd1')
  bevel(paint, x + 1, y - 16, 14, 31, '#e9ecef', '#8a929c')
  rect(paint, x + 1, y - 4, 14, 1, '#8a929c')
  rect(paint, x + 11, y - 13, 2, 6, '#8a929c')
  rect(paint, x + 11, y - 1, 2, 6, '#8a929c')
}

/** A break-room counter: a countertop, and — for the coffeebar — a coffee maker with a green light. */
function counter(paint: Paint, x: number, y: number): void {
  rect(paint, x + 1, y + 1, 14, 14, '#353b45')
  rect(paint, x + 1, y + 1, 14, 4, '#9aa2ac')
  bevel(paint, x + 1, y + 1, 14, 14, '#b8c2cc', '#1c2026')
  rect(paint, x + 4, y - 8, 9, 12, '#2c3139')
  bevel(paint, x + 4, y - 8, 9, 12, '#4b5260', '#12161b')
  rect(paint, x + 6, y - 6, 5, 3, '#12161b')
  rect(paint, x + 7, y - 2, 3, 3, '#e9ecef')
  rect(paint, x + 11, y - 7, 1, 1, HALL.green)
}

function drawVendingProp(paint: Paint, prop: HallProp): void {
  const x = prop.x * TILE_PX
  const y = prop.y * TILE_PX
  rect(paint, x + 1, y - 17, 14, 32, '#8a2f2a')
  bevel(paint, x + 1, y - 17, 14, 32, '#b04a3c', '#4a1512')
  rect(paint, x + 3, y - 14, 7, 18, '#10151a')
  const cs = [HALL.amber, HALL.cyan, HALL.green, '#e9ecef']
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 2; c++) rect(paint, x + 4 + c * 3, y - 13 + r * 4, 2, 2, cs[(r + c) % 4])
  }
  rect(paint, x + 3, y + 7, 9, 5, '#1a1d22')
}

export function drawProp(paint: Paint, prop: HallProp, context: SceneContext, tMs: number): void {
  const kind: PropKind = prop.kind
  const x = prop.x * TILE_PX
  const y = prop.y * TILE_PX
  const w = prop.w * TILE_PX
  switch (kind) {
    case 'desk':
      return drawDesk(paint, prop, context, tMs)
    case 'rig':
      return drawRig(paint, prop, context, tMs)
    case 'bench':
      return drawBench(paint, prop, context, tMs)
    case 'press':
      return drawPress(paint, prop, context, tMs)
    case 'gate':
      return drawGate(paint, prop, context, tMs)
    case 'shelves':
      return drawShelves(paint, prop)
    case 'racks':
      return drawRacks(paint, prop, tMs)
    case 'statuswall':
      return drawStatuswall(paint, prop, context)
    case 'lockers':
      return drawLockers(paint, prop)
    case 'plant':
      return drawPlant(paint, prop, tMs)
    case 'chair':
      return drawChair(paint, prop, context)
    case 'partition':
      return partition(paint, prop)
    case 'restbench':
      return benchS(paint, x, y, w)
    case 'sofa':
      return sofa(paint, x, y, w)
    case 'table':
      return table(paint, x, y, w, false, prop.x)
    case 'lowtable':
      return table(paint, x, y, w, true, prop.x)
    case 'fridge':
      return drawFridge(paint, prop)
    case 'coffeebar':
      return counter(paint, x, y)
    case 'vending':
      return drawVendingProp(paint, prop)
    case 'dispatch':
      return drawDispatch(paint, prop, context)
    /* v8 ignore next 3 -- exhaustive union, unreachable */
    default: {
      const never: never = kind
      throw new Error(`unhandled prop kind: ${String(never)}`)
    }
  }
}
