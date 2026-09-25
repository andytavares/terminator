import type { HallMap, HallBelt, HallProp, PropKind } from '../layout.js'
import { TILE_PX } from '../layout.js'
import type { Crew } from '../sim.js'
import type { NodeState } from '../../line/run-graph.js'
import type { Paint } from './kit.js'
import { rect, bevel, rivets, wear, mulberry32 } from './kit.js'
import { HALL, CODE_LINE_COLORS } from './palette.js'

// One draw function per `PropKind`, plus the floor/wall bake and the belt and
// crate that move over it.
//
// The honesty rule lives in what each function reads out of `SceneContext`:
// a desk's screens, a rig's waveform and a gate's beacon each ask "is a
// present crew member actually doing the thing that would light this up"
// rather than animating on a clock. Ambient decor (a plant's sway, a rack's
// idle blink) is the one exception — nothing about a run makes those true or
// false, so a clock is the only honest input they have.

export interface SceneContext {
  readonly crew: readonly Crew[]
  readonly states: Readonly<Record<string, NodeState>>
  readonly gatesWaiting: readonly string[]
}

/** Rows 0–2 are the top wall on every `HallMap` — see `layout.ts`'s contract. */
const TOP_WALL_ROWS = 3

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

/** Floor plates, then the four walls with their door gaps. Deterministic: no `tMs`. */
export function bakeHall(map: HallMap, paint: Paint): void {
  const w = map.width * TILE_PX
  const faceH = (TOP_WALL_ROWS - 1) * TILE_PX

  for (let y = TOP_WALL_ROWS; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) paintFloorTile(paint, x, y)
  }

  // Walkway lines flanking every belt row, and the hazard hatch on the floor
  // tile before every press or gate — floor decals, so they bake once.
  for (const belt of map.belts) {
    belt.path.forEach((tile, i) => {
      if (i % 2 !== 0) return
      const x = tile.x * TILE_PX
      const y = tile.y * TILE_PX
      rect(paint, x + 2, y + 1, 5, 2, HALL.amberDim)
      rect(paint, x + 2, y + TILE_PX - 3, 5, 2, HALL.amberDim)
    })
  }
  for (const prop of map.props) {
    if (prop.kind !== 'press' && prop.kind !== 'gate') continue
    hazardHatch(paint, (prop.x - 1) * TILE_PX, prop.y * TILE_PX, TILE_PX, prop.h * TILE_PX)
  }

  // A rug under the lounge band, and a lane number stencil at the left edge
  // of every lane's belt row.
  if (map.anchors.lounge.length > 0) {
    const xs = map.anchors.lounge.map((t) => t.x)
    const ys = map.anchors.lounge.map((t) => t.y)
    const x0 = Math.min(...xs)
    const x1 = Math.max(...xs)
    const y0 = Math.min(...ys)
    const y1 = Math.max(...ys)
    for (let ry = y0; ry <= y1; ry++) {
      for (let rx = x0; rx <= x1; rx++) {
        rect(
          paint,
          rx * TILE_PX,
          ry * TILE_PX,
          TILE_PX,
          TILE_PX,
          (rx + ry) % 2 ? HALL.rug : HALL.rug2
        )
      }
    }
  }
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
}

/** A full conveyor: rails and a dark bed, with treads that scroll only while a crate rides it. */
export function drawBelt(paint: Paint, belt: HallBelt, moving: boolean, tMs: number): void {
  const top = 3
  const bedH = 10
  const offset = moving ? Math.floor(tMs / 70) % 6 : 0
  for (const tile of belt.path) {
    const x = tile.x * TILE_PX
    const y = tile.y * TILE_PX

    rect(paint, x, y + top - 1, TILE_PX, 1, HALL.steelLight)
    rect(paint, x, y + top, TILE_PX, bedH, '#15181d')
    rect(paint, x, y + top + bedH, TILE_PX, 1, HALL.steelLight)
    rect(paint, x, y + top + bedH + 1, TILE_PX, 1, '#0a0c0f')

    for (let tx = -6 + offset; tx < TILE_PX; tx += 6) {
      if (tx < 0) continue
      rect(paint, x + tx, y + top + 1, 1, bedH - 2, '#2b3038')
    }
    rect(paint, x + 1, y + top + 1, 1, bedH - 2, HALL.steelDark)
    rect(paint, x + TILE_PX - 2, y + top + 1, 1, bedH - 2, HALL.steelDark)
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

function drawCouch(paint: Paint, prop: HallProp): void {
  const x = prop.x * TILE_PX
  const y = prop.y * TILE_PX
  const w = prop.w * TILE_PX

  rect(paint, x, y - 2, w, 8, '#5a3f4f')
  bevel(paint, x, y - 2, w, 8, '#74536a', '#3a2833')
  rect(paint, x + 1, y + 6, w - 2, 7, '#6a4b5e')
}

function drawCoffee(paint: Paint, prop: HallProp): void {
  const x = prop.x * TILE_PX
  const y = prop.y * TILE_PX

  rect(paint, x + 2, y - 8, 12, 22, '#2c3139')
  bevel(paint, x + 2, y - 8, 12, 22, '#4b5260', '#12161b')
  rect(paint, x + 4, y - 5, 8, 5, '#12161b')
  rect(paint, x + 6, y + 4, 4, 5, '#1a1e24')
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

function drawBooth(paint: Paint, prop: HallProp): void {
  const x = prop.x * TILE_PX
  const y = prop.y * TILE_PX
  const w = prop.w * TILE_PX

  rect(paint, x, y + 2, w, 9, '#4a4136')
  bevel(paint, x, y + 2, w, 9, '#6a5d4c', '#332c25')
  rect(paint, x + w - 12, y - 3, 8, 6, '#14171c')
  rect(paint, x + w - 11, y - 2, 6, 4, '#10262e')
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

export function drawProp(paint: Paint, prop: HallProp, context: SceneContext, tMs: number): void {
  const kind: PropKind = prop.kind
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
    case 'couch':
      return drawCouch(paint, prop)
    case 'coffee':
      return drawCoffee(paint, prop)
    case 'plant':
      return drawPlant(paint, prop, tMs)
    case 'booth':
      return drawBooth(paint, prop)
    case 'chair':
      return drawChair(paint, prop, context)
    /* v8 ignore next 3 -- exhaustive union, unreachable */
    default: {
      const never: never = kind
      throw new Error(`unhandled prop kind: ${String(never)}`)
    }
  }
}
