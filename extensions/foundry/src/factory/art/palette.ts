// Colour is illustration here (Constitution XII): the hall, its fixtures and
// its crew may use colour freely. Every token below is `#rrggbb` or an rgba
// string for a canvas fill — never a `--tm-*` design token, which stays
// reserved for the chrome around the scene (toggle, band, drawer, ticker).

export const HALL = {
  plate: '#2b3039',
  plate2: '#2f3540',
  seam: '#1b1f26',
  hi: '#3a414d',
  rivet: '#4d5563',
  wear: '#252930',
  wallTop: '#12151b',
  wallFace: '#252a34',
  wallPanel: '#1d2129',
  wallTrim: '#3c4351',
  door: '#0d1015',
  amber: '#e0a13a',
  amberDim: '#8a5f1c',
  steel: '#5d6674',
  steelDark: '#3c434e',
  steelLight: '#7c8696',
  deskTop: '#4f5663',
  deskFace: '#353b45',
  deskEdge: '#6d7684',
  cyan: '#72d8f2',
  green: '#8fe07e',
  red: '#e2553d',
  rug: '#3a2f3a',
  rug2: '#453845',
  leaf: '#4f8f4a',
  leafDark: '#35663a',
  pot: '#6b4a36',
  screenOff: '#0e1116',
  screenOn: '#0b2a33',
} as const

export const CODE_LINE_COLORS: readonly string[] = [
  '#72d8f2',
  '#8fe07e',
  '#e8c56a',
  '#c9a2f2',
  '#9fb0c4',
]

export interface RoleStyle {
  readonly shirt: string
  readonly shirtDark: string
  readonly hair: string
  readonly skin: string
  readonly pants: string
  readonly hat: string | null
  readonly visor: boolean
  readonly vest: boolean
}

const NEUTRAL: RoleStyle = {
  shirt: '#5d6674',
  shirtDark: '#454c58',
  hair: '#3b3430',
  skin: '#c68e62',
  pants: '#2a2e38',
  hat: null,
  visor: false,
  vest: false,
}

/**
 * A crew member's silhouette, by role.
 *
 * Only the roles the design calls out get a distinct look; every other role
 * — including one the recipe author invented — draws as `NEUTRAL` rather
 * than falling through a lookup with a hole in it.
 */
export function roleStyle(role: string | null): RoleStyle {
  switch (role) {
    case 'builder':
      return {
        shirt: '#4f6ea8',
        shirtDark: '#384f7a',
        hair: '#3b2a20',
        skin: '#c68e62',
        pants: '#2a2e38',
        hat: '#e3b341',
        visor: false,
        vest: false,
      }
    case 'foreman':
      return {
        shirt: '#f28c28',
        shirtDark: '#c86e1c',
        hair: '#2a2420',
        skin: '#d9a57c',
        pants: '#262a33',
        hat: '#e9ecef',
        visor: false,
        vest: true,
      }
    case 'verifier':
      return {
        shirt: '#d8dde4',
        shirtDark: '#a9b0ba',
        hair: '#6b3d25',
        skin: '#edc9a6',
        pants: '#343a46',
        hat: null,
        visor: true,
        vest: false,
      }
    case 'inspector':
      return {
        shirt: '#6f9a91',
        shirtDark: '#517069',
        hair: '#1d1a18',
        skin: '#8d5a3b',
        pants: '#2b2f3a',
        hat: null,
        visor: true,
        vest: false,
      }
    case 'architect':
      return {
        shirt: '#3f8a86',
        shirtDark: '#2c615e',
        hair: '#d9d4cc',
        skin: '#e2c09c',
        pants: '#2b2f3a',
        hat: null,
        visor: false,
        vest: false,
      }
    case 'author':
      return {
        shirt: '#a65f8f',
        shirtDark: '#7a4468',
        hair: '#4a3628',
        skin: '#d9a57c',
        pants: '#2f2733',
        hat: null,
        visor: false,
        vest: false,
      }
    case 'scribe':
      return {
        shirt: '#7a8a4a',
        shirtDark: '#586335',
        hair: '#241e1b',
        skin: '#e2c09c',
        pants: '#2a2e2a',
        hat: null,
        visor: false,
        vest: false,
      }
    case 'scout':
      return {
        shirt: '#c9a248',
        shirtDark: '#977a34',
        hair: '#1d1a18',
        skin: '#8d5a3b',
        pants: '#2e2a20',
        hat: null,
        visor: false,
        vest: false,
      }
    default:
      return NEUTRAL
  }
}
