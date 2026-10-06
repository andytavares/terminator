import { TILE_PX } from '../layout.js'
import type { HallProp, Tile } from '../layout.js'

// Where each labelled fixture sits, in hall pixels. The art draws inside these
// and the in-scene labels are laid over them, so one place says how big a
// sign is.

export interface Rect {
  readonly left: number
  readonly top: number
  /** Exclusive. */
  readonly right: number
  /** Exclusive. */
  readonly bottom: number
}

/** A board's height above its wall row: icon, gap, two-pixel digits, frame. */
export const BOARD_HEIGHT = 26
/** The queue plate: sixteen square, so a one-pixel digit has air round it. */
export const PLATE_SIZE = 16
/** The tower's body, and the beacon that sits on top of it. */
export const TOWER_HEIGHT = 24
export const BEACON_HEIGHT = 3

export function boardRect(prop: HallProp): Rect {
  const left = prop.x * TILE_PX
  const bottom = prop.y * TILE_PX
  return { left, top: bottom - BOARD_HEIGHT, right: left + prop.w * TILE_PX, bottom }
}

export function plateRect(exit: Tile): Rect {
  const left = exit.x * TILE_PX - 18
  const bottom = exit.y * TILE_PX - 28
  return { left, top: bottom - PLATE_SIZE, right: left + PLATE_SIZE, bottom }
}

export function towerRect(prop: HallProp): Rect {
  const bottom = prop.y * TILE_PX
  return {
    left: prop.x * TILE_PX + 1,
    top: bottom - TOWER_HEIGHT - BEACON_HEIGHT,
    right: prop.x * TILE_PX + TILE_PX - 1,
    bottom,
  }
}

export function junctionRect(tile: Tile): Rect {
  return {
    left: tile.x * TILE_PX,
    top: tile.y * TILE_PX,
    right: (tile.x + 1) * TILE_PX,
    bottom: (tile.y + 1) * TILE_PX,
  }
}
