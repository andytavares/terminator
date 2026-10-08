import { hasStarted } from './events.js'
import type { FactoryEvent } from './events.js'
import type { NodeState } from '../line/run-graph.js'
import type { StepKind } from '../recipe/parse.js'
import { VERDICT_MS, WALK_PX_PER_S } from './sim.js'

// The hall's own clock for its animations.
//
// The graph can pass several steps inside a few milliseconds, and `direct`
// applies a whole diff at once, so a gate would be drawn open before the crate
// reached it. This sits between `diffObservation` and `direct`: it holds each
// step's events until the step upstream has had time to show its own, then
// hands them on in the order they happened. It delays an animation, never
// drops one, and it is pure: the same events and the same `nowMs` always
// release the same beats, live or in a replay.

/** How long a crate takes to ride a two-tile belt (34px/s over 32px, `sim.ts`). */
export const CRATE_RIDE_MS = 940

/** What an upstream step's last animation needs before the step it feeds may begin its own. */
export const MIN_DWELL_MS = CRATE_RIDE_MS + VERDICT_MS

/** No event waits longer than this behind the beats ahead of it; past it the rest catch up together. */
export const MAX_LAG_MS = 10_000

/**
 * How long a sent-back box takes to be carried to the earlier station.
 *
 * The scheduler sees graph nodes, not the hall map, so it cannot measure the
 * walk. This is a conservative stand-in: 30 tiles of 16px at the 46px/s walking
 * speed in `sim.ts`, a generous crossing of a laid-out hall.
 */
export const REWORK_WALK_MS = Math.round(((30 * 16) / WALK_PX_PER_S) * 1000)

/** One press stroke, for a join step that passes without ever being seen running. */
export const STROKE_MS = 700

export interface BeatNode {
  readonly id: string
  readonly kind: StepKind
  readonly dependsOn: readonly string[]
}

interface Held {
  readonly event: FactoryEvent
  readonly due: number
}

export interface Beats {
  readonly held: readonly Held[]
  /** The state each node's station is showing: the last released event, not the observation. */
  readonly shown: Readonly<Record<string, NodeState>>
  /** When each node's last event is due, so the next one lands after it. */
  readonly lastAt: Readonly<Record<string, number>>
  /** When each node's last passed or failed event is due: the start of the animation its feeders wait out. */
  readonly lastBeat: Readonly<Record<string, number>>
}

export function createBeats(states: Readonly<Record<string, NodeState>>): Beats {
  return { held: [], shown: { ...states }, lastAt: {}, lastBeat: {} }
}

function subjectOf(event: FactoryEvent): string | null {
  switch (event.kind) {
    case 'handoff':
      return event.fromNodeId
    case 'rework':
      return event.toNodeId
    case 'ci-round':
    case 'ci-check':
    case 'queued':
      return null
    default:
      return event.nodeId
  }
}

function animates(event: FactoryEvent): boolean {
  return event.kind === 'node-state' && (event.to === 'passed' || event.to === 'failed')
}

/** Take in the events of one observation, deciding when each is due. */
export function schedule(
  beats: Beats,
  events: readonly FactoryEvent[],
  nodes: readonly BeatNode[],
  nowMs: number
): Beats {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const held = [...beats.held]
  const shown = { ...beats.shown }
  const lastAt = { ...beats.lastAt }
  const lastBeat = { ...beats.lastBeat }
  // What each node will show once everything held has been released.
  const eventual = { ...beats.shown }
  for (const h of held) if (h.event.kind === 'node-state') eventual[h.event.nodeId] = h.event.to

  const place = (event: FactoryEvent, minDue: number): number => {
    const subject = subjectOf(event)
    if (subject === null) {
      held.push({ event, due: nowMs })
      return nowMs
    }
    const upstreams = event.kind === 'node-state' ? (byId.get(event.nodeId)?.dependsOn ?? []) : []
    let due = Math.max(nowMs, minDue)
    let floor = lastAt[subject] ?? 0
    for (const upstream of upstreams) {
      const beat = lastBeat[upstream]
      if (beat === undefined) continue
      due = Math.max(due, beat + MIN_DWELL_MS)
      floor = Math.max(floor, beat)
    }
    // Lag is capped, but never so far that a step lands before the one feeding it.
    due = Math.max(Math.min(due, nowMs + MAX_LAG_MS), floor)
    held.push({ event, due })
    lastAt[subject] = event.kind === 'rework' ? due + REWORK_WALK_MS : due
    if (animates(event)) lastBeat[subject] = due
    return due
  }

  for (const event of events) {
    if (event.kind === 'node-state') {
      const unseen = !hasStarted(eventual[event.nodeId] ?? 'waiting')
      if (animates(event) && unseen && byId.get(event.nodeId)?.kind === 'join') {
        // A join that passes unseen still strokes once: the press animates
        // while its step is running, so it is shown running for a stroke first.
        const strokeAt = place({ ...event, to: 'running' }, 0)
        place(event, strokeAt + STROKE_MS)
      } else {
        place(event, 0)
      }
      eventual[event.nodeId] = event.to
    } else {
      place(event, 0)
    }
  }
  return { held, shown, lastAt, lastBeat }
}

/** The events now due, in the order they were taken in, and what is left held. */
export function release(
  beats: Beats,
  nowMs: number
): { readonly beats: Beats; readonly events: readonly FactoryEvent[] } {
  const due = beats.held.filter((h) => h.due <= nowMs)
  if (due.length === 0) return { beats, events: [] }
  const shown = { ...beats.shown }
  const events = due.map(({ event }) => {
    if (event.kind === 'node-state') {
      shown[event.nodeId] = event.to
    } else if (event.kind === 'handoff') {
      // Whether the next step is under way is what the scene shows now, not what the graph says.
      return { ...event, targetStarted: hasStarted(shown[event.toNodeId] ?? 'waiting') }
    }
    return event
  })
  return { beats: { ...beats, held: beats.held.filter((h) => h.due > nowMs), shown }, events }
}
