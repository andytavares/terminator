import type { RunGraph, NodeState } from '../line/run-graph.js'
import type { ToolActivity } from '../runtime/transcript-tailer.js'
import type { Gate } from '../gates/rules.js'
import type { CiState } from '../line/ci-state.js'
import type { Check } from '../line/ci.js'

// What changed between two observations of a run, as events a director can
// act on.
//
// The honesty rule lives here: nothing in the scene moves or lights up
// without a cause, and a cause is exactly one of the variants below. A
// director that inferred motion from the raw observation instead of from this
// diff could invent movement the run never actually made — for instance
// walking a crew member to a seat on every poll instead of once, on arrival.

export interface Observation {
  readonly graph: RunGraph
  readonly orphaned: readonly string[]
  readonly stranded: readonly string[]
  readonly waiting: readonly Gate[]
  readonly activity: Readonly<Record<string, readonly ToolActivity[]>>
  readonly ci: CiState | null
}

export type ToolProp = 'archive' | 'rack' | 'desk'

export type FactoryEvent =
  | {
      readonly kind: 'node-state'
      readonly nodeId: string
      readonly from: NodeState | null
      readonly to: NodeState
    }
  | { readonly kind: 'orphaned'; readonly nodeId: string }
  | { readonly kind: 'stranded'; readonly nodeId: string; readonly on: boolean }
  | {
      readonly kind: 'tool'
      readonly nodeId: string
      readonly prop: ToolProp
      readonly callId: string
      readonly open: boolean
      readonly at: number
    }
  | {
      readonly kind: 'handoff'
      readonly fromNodeId: string
      readonly toNodeId: string
      /** Whether the next step is already under way, or the work queues at it. */
      readonly targetStarted: boolean
    }
  | { readonly kind: 'gate'; readonly nodeId: string; readonly waiting: boolean }
  | {
      readonly kind: 'rework'
      /** The check that sent the work back. */
      readonly fromNodeId: string
      /** The node the failure landed on. */
      readonly toNodeId: string
      /** `toNodeId`'s new feedback length — how many times it has been sent back, in all. */
      readonly round: number
    }
  | { readonly kind: 'ci-round'; readonly round: number; readonly max: number }
  | { readonly kind: 'ci-check'; readonly name: string; readonly bucket: Check['bucket'] }

const ARCHIVE_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead'])

export function toolProp(toolName: string, isShell: boolean): ToolProp {
  if (isShell) return 'rack'
  if (ARCHIVE_TOOLS.has(toolName)) return 'archive'
  return 'desk'
}

/** A step that has taken in its input — work bound for it no longer queues. */
export function hasStarted(state: NodeState): boolean {
  return state !== 'waiting' && state !== 'ready' && state !== 'blocked'
}

function activityKey(activity: ToolActivity): string {
  return `${activity.callId}:${activity.kind}`
}

/** The node id a gate concerns: its own, or the first open gate station. */
export function gateNodeId(gate: Gate, graph: RunGraph): string | null {
  if (gate.nodeId !== null) return gate.nodeId
  const node = graph.nodes.find((n) => n.kind === 'gate' && n.state !== 'passed')
  return node?.id ?? null
}

function gateNodeIds(waiting: readonly Gate[], graph: RunGraph): Set<string> {
  const ids = new Set<string>()
  for (const gate of waiting) {
    const id = gateNodeId(gate, graph)
    if (id !== null) ids.add(id)
  }
  return ids
}

function nodeOfSession(graph: RunGraph, sessionId: string): string | null {
  return graph.nodes.find((n) => n.sessionId === sessionId)?.id ?? null
}

export function diffObservation(prev: Observation | null, next: Observation): FactoryEvent[] {
  if (prev === null) return []

  const events: FactoryEvent[] = []
  const prevNodes = new Map(prev.graph.nodes.map((n) => [n.id, n]))

  for (const node of next.graph.nodes) {
    const before = prevNodes.get(node.id)
    const from = before?.state ?? null
    if (from !== node.state) {
      events.push({ kind: 'node-state', nodeId: node.id, from, to: node.state })
    }
  }

  const prevOrphaned = new Set(prev.orphaned)
  for (const nodeId of next.orphaned) {
    if (!prevOrphaned.has(nodeId)) events.push({ kind: 'orphaned', nodeId })
  }

  const prevStranded = new Set(prev.stranded)
  const nextStranded = new Set(next.stranded)
  for (const sessionId of next.stranded) {
    if (prevStranded.has(sessionId)) continue
    const nodeId = nodeOfSession(next.graph, sessionId)
    if (nodeId !== null) events.push({ kind: 'stranded', nodeId, on: true })
  }
  for (const sessionId of prev.stranded) {
    if (nextStranded.has(sessionId)) continue
    const nodeId = nodeOfSession(next.graph, sessionId)
    if (nodeId !== null) events.push({ kind: 'stranded', nodeId, on: false })
  }

  for (const [nodeId, activities] of Object.entries(next.activity)) {
    const before = new Set((prev.activity[nodeId] ?? []).map(activityKey))
    for (const activity of activities) {
      if (before.has(activityKey(activity))) continue
      events.push({
        kind: 'tool',
        nodeId,
        prop: toolProp(activity.toolName, activity.isShell),
        callId: activity.callId,
        open: activity.kind === 'tool_started',
        at: activity.at,
      })
    }
  }

  const nextNodes = new Map(next.graph.nodes.map((n) => [n.id, n]))
  for (const node of next.graph.nodes) {
    for (const fromNodeId of node.dependsOn) {
      const sourceNow = nextNodes.get(fromNodeId)
      if (sourceNow === undefined || sourceNow.state !== 'passed') continue
      const sourceBefore = prevNodes.get(fromNodeId)
      if (sourceBefore?.state === 'passed') continue
      events.push({
        kind: 'handoff',
        fromNodeId,
        toNodeId: node.id,
        targetStarted: hasStarted(node.state),
      })
    }
  }

  for (const node of next.graph.nodes) {
    const before = prevNodes.get(node.id)
    const { feedback } = node
    const prevLength = before?.feedback.length ?? 0
    if (feedback.length > prevLength) {
      const newest = feedback[feedback.length - 1]
      events.push({
        kind: 'rework',
        fromNodeId: newest.from,
        toNodeId: node.id,
        round: feedback.length,
      })
    }
  }

  const prevGateNodes = gateNodeIds(prev.waiting, prev.graph)
  const nextGateNodes = gateNodeIds(next.waiting, next.graph)
  for (const nodeId of nextGateNodes) {
    if (!prevGateNodes.has(nodeId)) events.push({ kind: 'gate', nodeId, waiting: true })
  }
  for (const nodeId of prevGateNodes) {
    if (!nextGateNodes.has(nodeId)) events.push({ kind: 'gate', nodeId, waiting: false })
  }

  if (next.ci !== null && (prev.ci === null || next.ci.round > prev.ci.round)) {
    events.push({ kind: 'ci-round', round: next.ci.round, max: next.ci.max })
  }

  if (next.ci !== null) {
    const prevBuckets = new Map<string, Check['bucket']>()
    for (const pull of prev.ci?.pulls ?? []) {
      for (const check of pull.checks) prevBuckets.set(check.name, check.bucket)
    }
    for (const pull of next.ci.pulls) {
      for (const check of pull.checks) {
        if (prevBuckets.get(check.name) !== check.bucket) {
          events.push({ kind: 'ci-check', name: check.name, bucket: check.bucket })
        }
      }
    }
  }

  return events
}

function name(labels: Readonly<Record<string, string>>, nodeId: string): string {
  return labels[nodeId] ?? nodeId
}

export function describeEvent(
  event: FactoryEvent,
  labels: Readonly<Record<string, string>>
): string {
  switch (event.kind) {
    case 'node-state':
      return `${name(labels, event.nodeId)} is now ${event.to}.`
    case 'orphaned':
      return `${name(labels, event.nodeId)}'s agent is gone.`
    case 'stranded':
      return event.on
        ? `${name(labels, event.nodeId)} is waiting on you.`
        : `${name(labels, event.nodeId)} is back to work.`
    case 'tool':
      return event.open
        ? `${name(labels, event.nodeId)} is using the ${event.prop}.`
        : `${name(labels, event.nodeId)} is done with the ${event.prop}.`
    case 'handoff':
      return `${name(labels, event.fromNodeId)} handed off to ${name(labels, event.toNodeId)}.`
    case 'gate':
      return event.waiting
        ? `${name(labels, event.nodeId)} is waiting at the gate.`
        : `${name(labels, event.nodeId)}'s gate cleared.`
    case 'rework':
      return `${name(labels, event.fromNodeId)} sent ${name(labels, event.toNodeId)} back (round ${event.round}).`
    case 'ci-round':
      return `CI round ${event.round} of ${event.max}.`
    case 'ci-check':
      return `${event.name} is now ${event.bucket}.`
    /* v8 ignore next 3 -- exhaustive union, unreachable */
    default: {
      const never: never = event
      throw new Error(`unhandled factory event: ${String(never)}`)
    }
  }
}
