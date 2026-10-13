import type { Crew, CrewAnim, Facing } from '../sim.js'
import type { At, Paint } from './kit.js'
import { rect, bevel } from './kit.js'
import { roleStyle, type RoleStyle } from './palette.js'
import { HALL } from './palette.js'
import { drawCrate } from './props.js'

// A crew member is drawn as a small layered silhouette: legs, torso, arms,
// head, then a role's hat — one exhaustive switch per axis (facing,
// then anim) so a new `CrewAnim` the sim adds is a compile error here, not a
// silently unposed sprite.

const WALK_FRAME_MS = 110
const WALK_FRAMES = 4

function shadow(paint: Paint, [x, y]: At, w: number): void {
  rect(paint, [x - w / 2, y - 1, w, 2], 'rgba(0,0,0,.35)')
}

function walkFrame(tMs: number, seed: number): number {
  return Math.floor(tMs / WALK_FRAME_MS + seed) % WALK_FRAMES
}

function drawLegs(
  paint: Paint,
  [x, y]: At,
  { facing, pants, frame }: { facing: Facing; pants: string; frame: number }
): void {
  const lift = [0, 1, 0, -1][frame]
  if (facing === 'E' || facing === 'W') {
    rect(paint, [x - 2 + lift, y - 7, 3, 6], pants)
    rect(paint, [x - 1 - lift, y - 7, 3, 6], '#1f222a')
    return
  }
  rect(paint, [x - 3, y - 7 + Math.min(lift, 0), 3, 6 + Math.max(-lift, 0)], pants)
  rect(paint, [x, y - 7 + Math.max(-lift, 0), 3, 6 + Math.max(lift, 0)], pants)
}

/** One arm: how far below the shoulder it starts, and how long the sleeve is. */
type Arm = readonly [dy: number, len: number]

/** Each anim's arms, left then right, at a moment; none while sunk in the couch. */
const ARM_POSES: Record<CrewAnim, (tMs: number) => readonly [Arm, Arm] | null> = {
  type: (tMs) => {
    const k = Math.floor(tMs / 100) % 2
    return [
      [k ? -1 : 0, 4],
      [k ? 0 : -1, 4],
    ]
  },
  reach: () => [
    [0, 5],
    [-3, 6],
  ],
  wave: (tMs) => {
    const wv = Math.floor(tMs / 200) % 2
    return [
      [0, 5],
      [-6 - wv, 8],
    ]
  },
  scan: () => [
    [0, 5],
    [1, 3],
  ],
  slump: () => [
    [2, 4],
    [2, 4],
  ],
  couch: () => null,
  walk: (tMs) => {
    const swing = [1, 0, -1, 0][walkFrame(tMs, 0)]
    return [
      [swing, 5],
      [-swing, 5],
    ]
  },
  idle: () => [
    [0, 5],
    [0, 5],
  ],
}

/** What an arm is drawn in: the sleeve's shade and the hand's skin. */
interface ArmLook {
  readonly anim: CrewAnim
  readonly skin: string
  readonly shirtDark: string
  readonly tMs: number
}

function drawArms(paint: Paint, [x, topY]: At, { anim, skin, shirtDark, tMs }: ArmLook): void {
  const pose = ARM_POSES[anim](tMs)
  if (pose === null) return
  const arm = (side: -1 | 1, [dy, len]: Arm): void => {
    const ax = side < 0 ? x - 6 : x + 4
    rect(paint, [ax, topY + dy, 2, len], shirtDark)
    rect(paint, [ax, topY + dy + len, 2, 2], skin)
  }
  arm(-1, pose[0])
  arm(1, pose[1])
}

/** How a head looks: which way it faces, and its skin, hair and visor. */
interface HeadLook {
  readonly facing: Facing
  readonly skin: string
  readonly hair: string
  readonly visor: boolean
}

/** The hair, and the visor when there is one, as each facing shows them. */
const HAIR: Record<Facing, (paint: Paint, at: At, look: HeadLook) => void> = {
  N: (paint, [x, topY], { hair }) => {
    rect(paint, [x - 3, topY, 6, 5], hair)
  },
  S: (paint, [x, topY], { hair, visor }) => {
    rect(paint, [x - 3, topY, 6, 2], hair)
    if (visor) rect(paint, [x - 3, topY + 3, 6, 2], HALL.cyan)
  },
  E: (paint, [x, topY], { hair, visor }) => {
    rect(paint, [x - 3, topY, 6, 2], hair)
    rect(paint, [x - 3, topY + 2, 2, 3], hair)
    if (visor) rect(paint, [x, topY + 3, 3, 2], HALL.cyan)
  },
  W: (paint, [x, topY], { hair, visor }) => {
    rect(paint, [x - 3, topY, 6, 2], hair)
    rect(paint, [x + 1, topY + 2, 2, 3], hair)
    if (visor) rect(paint, [x - 3, topY + 3, 3, 2], HALL.cyan)
  },
}

function drawHead(paint: Paint, at: At, look: HeadLook): void {
  const [x, topY] = at
  rect(paint, [x - 3, topY + 1, 6, 7], look.skin)
  HAIR[look.facing](paint, at, look)
}

/** Where a crew member is drawn, in which colours, and when. */
interface Figure {
  readonly x: number
  readonly y: number
  readonly style: RoleStyle
  readonly tMs: number
}

export function drawCrew(paint: Paint, crew: Crew, tMs: number): void {
  if (!crew.present) return

  const style = roleStyle(crew.role)
  const x = Math.round(crew.x)
  const y = Math.round(crew.y)
  const seated = crew.anim === 'type'
  const lift = seated || crew.anim === 'couch' ? -3 : 0
  const bob = crew.anim === 'walk' ? walkFrame(tMs, crew.x) % 2 : 0
  const top = y - 22 + bob + lift
  const figure: Figure = { x, y, style, tMs }

  shadow(paint, [x, y], 10)
  drawLower(paint, crew, figure)
  drawTorso(paint, crew, { ...figure, y: top + 8 })
  drawHead(paint, [x, top], {
    facing: crew.facing,
    skin: style.skin,
    hair: style.hair,
    visor: style.visor,
  })

  if (style.hat !== null) {
    rect(paint, [x - 4, top - 1, 8, 3], style.hat)
    rect(paint, [x - 4, top + 1, 8, 1], 'rgba(0,0,0,.25)')
  }

  if (seated && crew.facing === 'N') {
    rect(paint, [x - 4, y - 10, 8, 7], '#343b49')
  }
}

/** The legs, folded on the couch or hidden behind the desk while typing. */
function drawLower(paint: Paint, crew: Crew, { x, y, style, tMs }: Figure): void {
  if (crew.anim === 'couch') {
    rect(paint, [x - 4, y - 6, 3, 4], style.pants)
    rect(paint, [x + 1, y - 6, 3, 4], style.pants)
  } else if (crew.anim !== 'type') {
    drawLegs(paint, [x, y], {
      facing: crew.facing,
      pants: style.pants,
      frame: crew.anim === 'walk' ? walkFrame(tMs, crew.x) : 0,
    })
  }
}

/** The torso at `y`, with the arms — or the crate they carry. */
function drawTorso(paint: Paint, crew: Crew, { x, y: torsoY, style, tMs }: Figure): void {
  const boxY = torsoY + 10
  // Facing away, the box is held in front of a body the viewer sees from behind.
  if (crew.carrying === true && crew.facing === 'N') drawCrate(paint, x, boxY)
  rect(paint, [x - 4, torsoY, 8, 8], style.shirt)
  bevel(paint, [x - 4, torsoY, 8, 8], { hi: 'rgba(255,255,255,.18)', lo: '#1c1f26' })
  rect(paint, [x + 2, torsoY, 2, 8], style.shirtDark)

  if (crew.carrying !== true) {
    drawArms(paint, [x, torsoY], {
      anim: crew.anim,
      skin: style.skin,
      shirtDark: style.shirtDark,
      tMs,
    })
    return
  }
  if (crew.facing === 'N') return
  drawCrate(paint, x, boxY)
  rect(paint, [x - 6, torsoY + 2, 2, 5], style.shirtDark)
  rect(paint, [x + 4, torsoY + 2, 2, 5], style.shirtDark)
  rect(paint, [x - 6, torsoY + 6, 2, 2], style.skin)
  rect(paint, [x + 4, torsoY + 6, 2, 2], style.skin)
}
