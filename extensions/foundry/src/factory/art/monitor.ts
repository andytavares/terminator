import type { Paint } from './kit.js'
import { rect } from './kit.js'
import { HALL } from './palette.js'

// The station monitor's beige case, drawn in art pixels with the hall's own
// rect kit. The caller clears the canvas first (Paint has no clearRect) and
// lays the live screen over the tube rectangle `monitorTube` returns.

export interface TubeRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export function monitorTube(w: number, h: number): TubeRect {
  return { x: 6, y: 6, w: w - 12, h: h - 27 }
}

export function drawMonitorCase(paint: Paint, w: number, h: number): void {
  const R = (x: number, y: number, ww: number, hh: number, c: string): void =>
    rect(paint, x, y, ww, hh, c)

  // body, with a two-step rounded corner
  R(2, 0, w - 4, h - 2, HALL.caseLine)
  R(0, 2, w, h - 6, HALL.caseLine)
  R(1, 1, w - 2, h - 4, HALL.caseLine)
  R(2, 1, w - 4, h - 4, HALL.caseFace)
  R(1, 2, w - 2, h - 7, HALL.caseFace)
  R(2, 1, w - 4, 1, HALL.caseHi)
  R(1, 2, 1, h - 7, HALL.caseHi)
  R(2, 2, 1, 1, HALL.caseHi)
  R(2, h - 4, w - 4, 1, HALL.caseLo)
  R(w - 2, 2, 1, h - 7, HALL.caseLo)
  R(w - 3, h - 5, 1, 1, HALL.caseLo)
  // a darker lip where the chin meets the tube bezel
  R(3, h - 22, w - 6, 1, HALL.caseLo)

  // recess around the tube
  const { x, y, w: tw, h: th } = monitorTube(w, h)
  R(x - 1, y - 1, tw + 2, th + 2, HALL.caseDeep)
  R(x, y, tw, th, HALL.caseRecess)
  R(x + 1, y + 1, tw - 2, th - 2, HALL.caseRecessDeep)
  R(x - 1, y + th + 1, tw + 2, 1, HALL.caseHi)
  R(x + 2, y + 2, tw - 4, th - 4, HALL.caseTube)

  // stand foot
  const mid = Math.floor(w / 2)
  R(mid - 10, h - 2, 20, 2, HALL.caseLine)
  R(mid - 9, h - 3, 18, 1, HALL.caseStand)
}
