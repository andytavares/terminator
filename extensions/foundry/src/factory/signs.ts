import { ordinal } from './format.js'
import { tallyChecks, waitingOnChecks } from './ci-tally.js'
import { boardRect, junctionRect, plateRect, towerRect } from './art/fixtures.js'
import type { Rect } from './art/fixtures.js'
import type { HallMap } from './layout.js'
import type { Check } from '../line/ci.js'

// What the hall says about the things it draws. A fixture that encodes a value
// (a scoreboard, a plate, a tower, a junction) gets one sentence here, shown
// on hover over the fixture and spoken as its accessible name. Pure, so the
// surface only decides how it looks (ADR 087).

export interface HallSign {
  readonly id: string
  readonly text: string
  /** In hall pixels. */
  readonly rect: Rect
}

export interface SignInput {
  readonly labels: Readonly<Record<string, string>>
  readonly metrics: {
    readonly leadTimeMs: number | null
    readonly reworks: number
    readonly ciRounds: number
  } | null
  readonly queue: { readonly position: number } | null
  readonly ci: { readonly checks: Readonly<Record<string, Check['bucket']>> } | null
}

const MINUTE_MS = 60_000

/** "A", "A and B", "A, B and C". */
export function joinedWords(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function scoreboardText(metrics: SignInput['metrics']): string {
  if (metrics === null) return 'Scoreboard · no figures yet'
  const lead =
    metrics.leadTimeMs === null
      ? 'Lead time not known yet'
      : `Lead time ${Math.round(metrics.leadTimeMs / MINUTE_MS)} min`
  return [
    lead,
    count(metrics.reworks, 'rework', 'reworks'),
    count(metrics.ciRounds, 'CI fix round', 'CI fix rounds'),
  ].join(' · ')
}

function towerText(ci: NonNullable<SignInput['ci']>): string | null {
  const tally = tallyChecks(Object.values(ci.checks))
  if (tally.total === 0) return null
  return waitingOnChecks(tally) ?? `Checks · ${tally.passed} passed · ${tally.failed} failed`
}

/** The signs for everything the hall draws that carries a value or a destination. */
export function hallSigns(map: HallMap, input: SignInput): HallSign[] {
  const signs: HallSign[] = []
  const nameOf = (nodeId: string): string => input.labels[nodeId] ?? nodeId

  const board = map.props.find((p) => p.kind === 'statuswall')
  if (board !== undefined) {
    signs.push({ id: 'scoreboard', text: scoreboardText(input.metrics), rect: boardRect(board) })
  }

  if (input.queue !== null) {
    signs.push({
      id: 'queue',
      text: `${ordinal(input.queue.position)} in the merge queue`,
      rect: plateRect(map.anchors.exit),
    })
  }

  const tower = map.props.find((p) => p.kind === 'dispatch')
  const waiting = tower === undefined || input.ci === null ? null : towerText(input.ci)
  if (tower !== undefined && waiting !== null) {
    signs.push({ id: 'tower', text: waiting, rect: towerRect(tower) })
  }

  for (const tile of map.beltTiles) {
    if (tile.kind !== 'split' && tile.kind !== 'merge') continue
    const leads = new Set<string>()
    for (const belt of map.belts) {
      if (belt.path.some((step) => step.x === tile.x && step.y === tile.y)) leads.add(belt.toNodeId)
    }
    if (leads.size === 0) continue
    const names = joinedWords([...leads].map(nameOf))
    signs.push({
      id: `${tile.kind}-${tile.x},${tile.y}`,
      text: tile.kind === 'split' ? `Splits to ${names}` : `Merges into ${names}`,
      rect: junctionRect(tile),
    })
  }

  return signs
}
