import type { Observation } from './events.js'
import type { Gate } from '../gates/rules.js'
import type { NodeState, RunGraph } from '../line/run-graph.js'
import type { ToolActivity } from '../runtime/transcript-tailer.js'

// A run played back.
//
// The hall is a projection of observations, so a replay is only a different
// source of them: what was recorded as the run went — each node's state as the
// graph was written, each tool call the stall watcher read — rebuilt into the
// observation the hall would have seen at any given moment, and fed through
// the same diff and director as a live run.
//
// A replay shows only what was recorded. Whether an agent's process was alive,
// or parked at its terminal, was never written down, so nothing in a replay is
// orphaned or stranded.

/** One node's recorded standing when the graph was written. */
export interface FrameNode {
  readonly id: string
  readonly state: NodeState
  readonly attempts: number
  readonly sessionId: string | null
}

export interface GraphFrame {
  readonly at: number
  readonly nodes: readonly FrameNode[]
}

export interface ToolEntry {
  readonly at: number
  readonly sessionId: string
  readonly activity: ToolActivity
}

export interface Timeline {
  readonly frames: readonly GraphFrame[]
  readonly tools: readonly ToolEntry[]
}

/** As many calls per node as the live activity channel hands back. */
const ACTIVITY_WINDOW = 20

function frameAt(timeline: Timeline, at: number): GraphFrame | null {
  let found: GraphFrame | null = timeline.frames[0] ?? null
  for (const frame of timeline.frames) {
    if (frame.at > at) break
    found = frame
  }
  return found
}

function decidedAt(gate: Gate): number | null {
  return gate.decision === null ? null : Date.parse(gate.decision.at)
}

/** What the hall would have observed at `at`, from what was recorded. */
export function observationAt(
  timeline: Timeline,
  gates: readonly Gate[],
  base: RunGraph,
  at: number
): Observation {
  const frame = frameAt(timeline, at)
  const recorded = new Map((frame?.nodes ?? []).map((n) => [n.id, n]))
  const graph: RunGraph = {
    ...base,
    nodes: base.nodes.map((node) => {
      const then = recorded.get(node.id)
      return then === undefined
        ? { ...node, state: 'waiting', attempts: 0, sessionId: null }
        : { ...node, state: then.state, attempts: then.attempts, sessionId: then.sessionId }
    }),
  }

  const activity: Record<string, ToolActivity[]> = {}
  for (const entry of timeline.tools) {
    if (entry.at > at) continue
    // The node a session belonged to when the call was made, not now: a
    // retried step carries a new session, and its old calls stay its own.
    const owner = frameAt(timeline, entry.at)?.nodes.find((n) => n.sessionId === entry.sessionId)
    if (owner === undefined) continue
    ;(activity[owner.id] ??= []).push(entry.activity)
  }
  for (const nodeId of Object.keys(activity)) {
    activity[nodeId] = activity[nodeId].slice(-ACTIVITY_WINDOW)
  }

  const waiting = gates.filter((gate) => {
    const decided = decidedAt(gate)
    return Date.parse(gate.raisedAt) <= at && (decided === null || decided > at)
  })

  // The timeline never records CI (ADR-060: only what was recorded plays
  // back), so a replay shows no dispatch tower at any point in a run.
  return { graph, orphaned: [], stranded: [], waiting, activity, ci: null }
}

/** Every recorded moment, in order: the beats a replay's clock is built on. */
export function momentsOf(timeline: Timeline, gates: readonly Gate[]): number[] {
  const all = new Set<number>()
  for (const frame of timeline.frames) all.add(frame.at)
  for (const entry of timeline.tools) all.add(entry.at)
  for (const gate of gates) {
    all.add(Date.parse(gate.raisedAt))
    const decided = decidedAt(gate)
    if (decided !== null) all.add(decided)
  }
  return [...all].sort((a, b) => a - b)
}

export interface ReplayClock {
  /** Length of the replay at 1×, in ms. */
  readonly duration: number
  /** The recorded moment a point in the replay stands for. */
  toReal(replayMs: number): number
}

/**
 * A replay's clock: real time between moments, with every quiet stretch
 * capped at `maxGapMs`.
 *
 * A run that sat at a gate overnight would otherwise replay as eight hours of
 * nothing; capped, the wait is still visible as a pause, and the work either
 * side of it plays at the pace it happened.
 */
export function replayClock(moments: readonly number[], maxGapMs: number): ReplayClock {
  if (moments.length === 0) return { duration: 0, toReal: () => 0 }
  const starts: number[] = [0]
  for (let i = 1; i < moments.length; i++) {
    starts.push(starts[i - 1] + Math.min(moments[i] - moments[i - 1], maxGapMs))
  }
  const duration = starts[starts.length - 1]
  return {
    duration,
    toReal(replayMs: number): number {
      const t = Math.min(Math.max(replayMs, 0), duration)
      let i = 0
      while (i < starts.length - 1 && starts[i + 1] <= t) i++
      if (i === starts.length - 1) return moments[i]
      const span = starts[i + 1] - starts[i]
      const real = moments[i + 1] - moments[i]
      return moments[i] + ((t - starts[i]) / span) * real
    },
  }
}
