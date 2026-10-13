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
const CRATE_RIDE_MS = 940

/**
 * What an upstream step's last animation needs before the step it feeds may begin its own.
 * @internal
 */
export const MIN_DWELL_MS = CRATE_RIDE_MS + VERDICT_MS

/**
 * No event waits longer than this behind the beats ahead of it; past it the rest catch up together.
 * @internal
 */
export const MAX_LAG_MS = 10_000

/**
 * How long a sent-back box takes to be carried to the earlier station.
 *
 * The scheduler sees graph nodes, not the hall map, so it cannot measure the
 * walk. This is a conservative stand-in: 30 tiles of 16px at the 46px/s walking
 * speed in `sim.ts`, a generous crossing of a laid-out hall.
 * @internal
 */
export const REWORK_WALK_MS = Math.round(((30 * 16) / WALK_PX_PER_S) * 1000)

/**
 * One press stroke, for a join step that passes without ever being seen running.
 * @internal
 */
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

/** One observation's worth of events, and the nodes they concern. */
export interface Seen {
  readonly events: readonly FactoryEvent[]
  readonly nodes: readonly BeatNode[]
}

/** Take in the events of one observation, deciding when each is due. */
export function schedule(beats: Beats, { events, nodes }: Seen, nowMs: number): Beats {
  // Same object back, so a poll that saw nothing re-renders nothing.
  if (events.length === 0) return beats
  const scheduler = new Scheduler(beats, { nodes, nowMs })
  for (const event of events) scheduler.take(event)
  return scheduler.beats()
}

/** The beats being scheduled: copies of the held events and their clocks, added to in order. */
class Scheduler {
  private readonly byId: Map<string, BeatNode>
  private readonly nowMs: number
  private readonly held: Held[]
  private readonly shown: Record<string, NodeState>
  private readonly lastAt: Record<string, number>
  private readonly lastBeat: Record<string, number>
  /** What each node will show once everything held has been released. */
  private readonly eventual: Record<string, NodeState>

  constructor(beats: Beats, { nodes, nowMs }: Pick<Seen, 'nodes'> & { readonly nowMs: number }) {
    this.byId = new Map(nodes.map((n) => [n.id, n]))
    this.nowMs = nowMs
    this.held = [...beats.held]
    this.shown = { ...beats.shown }
    this.lastAt = { ...beats.lastAt }
    this.lastBeat = { ...beats.lastBeat }
    this.eventual = { ...beats.shown }
    for (const h of this.held) {
      if (h.event.kind === 'node-state') this.eventual[h.event.nodeId] = h.event.to
    }
  }

  beats(): Beats {
    return { held: this.held, shown: this.shown, lastAt: this.lastAt, lastBeat: this.lastBeat }
  }

  take(event: FactoryEvent): void {
    if (event.kind !== 'node-state') {
      this.place(event, 0)
      return
    }
    const unseen = !hasStarted(this.eventual[event.nodeId] ?? 'waiting')
    if (animates(event) && unseen && this.byId.get(event.nodeId)?.kind === 'join') {
      // A join that passes unseen still strokes once: the press animates
      // while its step is running, so it is shown running for a stroke first.
      const strokeAt = this.place({ ...event, to: 'running' }, 0)
      this.place(event, strokeAt + STROKE_MS)
    } else {
      this.place(event, 0)
    }
    this.eventual[event.nodeId] = event.to
  }

  /** Holds `event` until it is due, no earlier than `minDue`; returns when that is. */
  private place(event: FactoryEvent, minDue: number): number {
    const { nowMs } = this
    const subject = subjectOf(event)
    if (subject === null) {
      this.held.push({ event, due: nowMs })
      return nowMs
    }
    const upstreams =
      event.kind === 'node-state' ? (this.byId.get(event.nodeId)?.dependsOn ?? []) : []
    let due = Math.max(nowMs, minDue)
    let floor = this.lastAt[subject] ?? 0
    for (const upstream of upstreams) {
      const beat = this.lastBeat[upstream]
      if (beat === undefined) continue
      due = Math.max(due, beat + MIN_DWELL_MS)
      floor = Math.max(floor, beat)
    }
    // Lag is capped, but never so far that a step lands before the one feeding it.
    due = Math.max(Math.min(due, nowMs + MAX_LAG_MS), floor)
    this.held.push({ event, due })
    this.lastAt[subject] = event.kind === 'rework' ? due + REWORK_WALK_MS : due
    if (animates(event)) this.lastBeat[subject] = due
    return due
  }
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
