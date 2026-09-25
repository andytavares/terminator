import type { Crew, CrewAnim, Facing } from '../sim.js'
import type { Paint } from './kit.js'
import { rect, bevel } from './kit.js'
import { roleStyle } from './palette.js'
import { HALL } from './palette.js'

// A crew member is drawn as a small layered silhouette: legs, torso, arms,
// head, then a role's hat or vest — one exhaustive switch per axis (facing,
// then anim) so a new `CrewAnim` the sim adds is a compile error here, not a
// silently unposed sprite.

const WALK_FRAME_MS = 110
const WALK_FRAMES = 4

function shadow(paint: Paint, x: number, y: number, w: number): void {
  rect(paint, x - w / 2, y - 1, w, 2, 'rgba(0,0,0,.35)')
}

function walkFrame(tMs: number, seed: number): number {
  return Math.floor(tMs / WALK_FRAME_MS + seed) % WALK_FRAMES
}

function drawLegs(
  paint: Paint,
  x: number,
  y: number,
  facing: Facing,
  pants: string,
  frame: number
): void {
  const lift = [0, 1, 0, -1][frame]
  if (facing === 'E' || facing === 'W') {
    rect(paint, x - 2 + lift, y - 7, 3, 6, pants)
    rect(paint, x - 1 - lift, y - 7, 3, 6, '#1f222a')
    return
  }
  rect(paint, x - 3, y - 7 + Math.min(lift, 0), 3, 6 + Math.max(-lift, 0), pants)
  rect(paint, x, y - 7 + Math.max(-lift, 0), 3, 6 + Math.max(lift, 0), pants)
}

function drawArms(
  paint: Paint,
  x: number,
  topY: number,
  anim: CrewAnim,
  skin: string,
  shirtDark: string,
  tMs: number
): void {
  function arm(side: -1 | 1, dy: number, len: number): void {
    const ax = side < 0 ? x - 6 : x + 4
    rect(paint, ax, topY + dy, 2, len, shirtDark)
    rect(paint, ax, topY + dy + len, 2, 2, skin)
  }
  switch (anim) {
    case 'type': {
      const k = Math.floor(tMs / 100) % 2
      arm(-1, k ? -1 : 0, 4)
      arm(1, k ? 0 : -1, 4)
      return
    }
    case 'reach':
      arm(-1, 0, 5)
      arm(1, -3, 6)
      return
    case 'wave': {
      const wv = Math.floor(tMs / 200) % 2
      arm(-1, 0, 5)
      arm(1, -6 - wv, 8)
      return
    }
    case 'scan':
      arm(-1, 0, 5)
      arm(1, 1, 3)
      return
    case 'slump':
      arm(-1, 2, 4)
      arm(1, 2, 4)
      return
    case 'couch':
      return
    case 'walk':
    case 'idle': {
      const swing = anim === 'walk' ? [1, 0, -1, 0][walkFrame(tMs, 0)] : 0
      arm(-1, swing, 5)
      arm(1, -swing, 5)
      return
    }
    /* v8 ignore next 3 -- exhaustive union, unreachable */
    default: {
      const never: never = anim
      throw new Error(`unhandled crew anim: ${String(never)}`)
    }
  }
}

function drawHead(
  paint: Paint,
  x: number,
  topY: number,
  facing: Facing,
  skin: string,
  hair: string,
  visor: boolean
): void {
  rect(paint, x - 3, topY + 1, 6, 7, skin)
  switch (facing) {
    case 'N':
      rect(paint, x - 3, topY, 6, 5, hair)
      return
    case 'S':
      rect(paint, x - 3, topY, 6, 2, hair)
      if (visor) rect(paint, x - 3, topY + 3, 6, 2, HALL.cyan)
      return
    case 'E':
      rect(paint, x - 3, topY, 6, 2, hair)
      rect(paint, x - 3, topY + 2, 2, 3, hair)
      if (visor) rect(paint, x, topY + 3, 3, 2, HALL.cyan)
      return
    case 'W':
      rect(paint, x - 3, topY, 6, 2, hair)
      rect(paint, x + 1, topY + 2, 2, 3, hair)
      if (visor) rect(paint, x - 3, topY + 3, 3, 2, HALL.cyan)
      return
    /* v8 ignore next 3 -- exhaustive union, unreachable */
    default: {
      const never: never = facing
      throw new Error(`unhandled facing: ${String(never)}`)
    }
  }
}

export function drawCrew(paint: Paint, crew: Crew, tMs: number): void {
  if (!crew.present) return

  const style = roleStyle(crew.role)
  const x = Math.round(crew.x)
  const y = Math.round(crew.y)
  const seated = crew.anim === 'type'
  const couch = crew.anim === 'couch'
  const lift = seated || couch ? -3 : 0
  const bob = crew.anim === 'walk' ? walkFrame(tMs, crew.x) % 2 : 0
  const top = y - 22 + bob + lift

  shadow(paint, x, y, 10)

  if (couch) {
    rect(paint, x - 4, y - 6, 3, 4, style.pants)
    rect(paint, x + 1, y - 6, 3, 4, style.pants)
  } else if (!seated) {
    drawLegs(
      paint,
      x,
      y,
      crew.facing,
      style.pants,
      crew.anim === 'walk' ? walkFrame(tMs, crew.x) : 0
    )
  }

  const torsoY = top + 8
  rect(paint, x - 4, torsoY, 8, 8, style.shirt)
  bevel(paint, x - 4, torsoY, 8, 8, 'rgba(255,255,255,.18)', '#1c1f26')
  rect(paint, x + 2, torsoY, 2, 8, style.shirtDark)
  if (style.vest) {
    rect(paint, x - 4, torsoY, 8, 8, '#f28c28')
    rect(paint, x - 4, torsoY + 4, 8, 1, '#f4f4f0')
  }

  drawArms(paint, x, torsoY, crew.anim, style.skin, style.shirtDark, tMs)
  drawHead(paint, x, top, crew.facing, style.skin, style.hair, style.visor)

  if (style.hat !== null) {
    rect(paint, x - 4, top - 1, 8, 3, style.hat)
    rect(paint, x - 4, top + 1, 8, 1, 'rgba(0,0,0,.25)')
  }

  if (seated && crew.facing === 'N') {
    rect(paint, x - 4, y - 10, 8, 7, '#343b49')
  }
}
