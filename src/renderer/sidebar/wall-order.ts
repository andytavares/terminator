import type { SessionFacts } from './session-facts'
import type { WallPrefs } from './wall-prefs'
import { standingRank } from './view-model'

export interface WallPlacement {
  sessionId: string
  band: 'needs' | 'rest'
  /** CSS `order`. 0 is the Needs you heading and `needsCount + 1` the heading after it. */
  order: number
  span: 1 | 2
}

export interface WallLayout {
  placements: WallPlacement[]
  needsCount: number
}

const byStarted = (a: SessionFacts, b: SessionFacts): number =>
  Date.parse(a.startedAt) - Date.parse(b.startedAt)

/** Most recently opened first, a session that has never been attended sorting last. */
const byRecentlyOpened = (a: SessionFacts, b: SessionFacts): number => {
  if (a.lastAttendedAt === null && b.lastAttendedAt === null) return byStarted(a, b)
  if (a.lastAttendedAt === null) return 1
  if (b.lastAttendedAt === null) return -1
  return b.lastAttendedAt - a.lastAttendedAt || byStarted(a, b)
}

function thenBy(prefs: WallPrefs) {
  return (a: SessionFacts, b: SessionFacts): number => {
    if (prefs.thenBy === 'recent') return byRecentlyOpened(a, b)
    if (prefs.thenBy === 'workspace-project') {
      const where = (f: SessionFacts) => `${f.workspaceName ?? ''}/${f.projectName ?? ''}/${f.name}`
      return where(a).localeCompare(where(b)) || byStarted(a, b)
    }
    return standingRank(a.state) - standingRank(b.state) || byStarted(a, b)
  }
}

/**
 * Where each live tile goes.
 *
 * The placements are emitted in session id order whatever the arrangement, and
 * position is carried by `order` and `span` alone. `mountPreview` moves a
 * session's one live terminal into its tile, so a tile that React reordered or
 * re-parented would lose its preview mid-move; with a stable emission order a
 * state change rewrites two style properties and nothing else (ADR 036, 054).
 */
export function placeWall(facts: readonly SessionFacts[], prefs: WallPrefs): WallLayout {
  const open = facts.filter((f) => !f.isClosed)
  const needs = prefs.pinNeeds
    ? open.filter((f) => f.state === 'awaiting-input').sort(byStarted)
    : []
  const needsIds = new Set(needs.map((f) => f.sessionId))
  const rest = open.filter((f) => !needsIds.has(f.sessionId)).sort(thenBy(prefs))

  const orderOf = new Map<string, number>()
  needs.forEach((f, i) => orderOf.set(f.sessionId, i + 1))
  rest.forEach((f, i) => orderOf.set(f.sessionId, needs.length + 2 + i))

  const placements = [...open]
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId))
    .map((f): WallPlacement => {
      const pinned = needsIds.has(f.sessionId)
      return {
        sessionId: f.sessionId,
        band: pinned ? 'needs' : 'rest',
        order: orderOf.get(f.sessionId)!,
        span: pinned ? 2 : 1,
      }
    })

  return { placements, needsCount: needs.length }
}
