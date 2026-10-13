import type { RunGraph, NodeState } from '../line/run-graph.js'
import type { ToolActivity } from '../runtime/transcript-tailer.js'
import type { Gate } from '../gates/rules.js'
import type { CiState } from '../line/ci-state.js'
import type { Check } from '../line/ci.js'
import { ordinal } from './format.js'

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
  /** This order's place in the refinery's file-overlap queue. Null out of a queue, or in a replay. */
  readonly queue: {
    readonly position: number
    readonly behind: readonly { readonly orderId: string; readonly title: string }[]
  } | null
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
  | { readonly kind: 'queued'; readonly position: number; readonly behind: readonly string[] }

const ARCHIVE_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead'])

export function toolProp(toolName: string, isShell: boolean): ToolProp {
  if (isShell) return 'rack'
  if (ARCHIVE_TOOLS.has(toolName)) return 'archive'
  return 'desk'
}

/** A step that has taken in its input — work bound for it no longer queues. */
export function hasStarted(state: NodeState): boolean {
  return state !== 'waiting' && state !== 'blocked'
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

/** What changed between two observations of one kind; each reads the pair for itself. */
type ChangeReader = (prev: Observation, next: Observation) => FactoryEvent[]

export function diffObservation(prev: Observation | null, next: Observation): FactoryEvent[] {
  if (prev === null) return []
  return CHANGE_READERS.flatMap((read) => read(prev, next))
}

function stateChanges(prev: Observation, next: Observation): FactoryEvent[] {
  const prevNodes = new Map(prev.graph.nodes.map((n) => [n.id, n]))
  const events: FactoryEvent[] = []
  for (const node of next.graph.nodes) {
    const from = prevNodes.get(node.id)?.state ?? null
    if (from !== node.state) {
      events.push({ kind: 'node-state', nodeId: node.id, from, to: node.state })
    }
  }
  return events
}

function orphanChanges(prev: Observation, next: Observation): FactoryEvent[] {
  const prevOrphaned = new Set(prev.orphaned)
  return next.orphaned
    .filter((nodeId) => !prevOrphaned.has(nodeId))
    .map((nodeId): FactoryEvent => ({ kind: 'orphaned', nodeId }))
}

function strandedChanges(prev: Observation, next: Observation): FactoryEvent[] {
  const events: FactoryEvent[] = []
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
  return events
}

function toolChanges(prev: Observation, next: Observation): FactoryEvent[] {
  const events: FactoryEvent[] = []
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
  return events
}

function handoffChanges(prev: Observation, next: Observation): FactoryEvent[] {
  const prevNodes = new Map(prev.graph.nodes.map((n) => [n.id, n]))
  const nextNodes = new Map(next.graph.nodes.map((n) => [n.id, n]))
  const events: FactoryEvent[] = []
  for (const node of next.graph.nodes) {
    for (const fromNodeId of node.dependsOn) {
      const sourceNow = nextNodes.get(fromNodeId)
      if (sourceNow === undefined || sourceNow.state !== 'passed') continue
      if (prevNodes.get(fromNodeId)?.state === 'passed') continue
      events.push({
        kind: 'handoff',
        fromNodeId,
        toNodeId: node.id,
        targetStarted: hasStarted(node.state),
      })
    }
  }
  return events
}

function reworkChanges(prev: Observation, next: Observation): FactoryEvent[] {
  const prevNodes = new Map(prev.graph.nodes.map((n) => [n.id, n]))
  const events: FactoryEvent[] = []
  for (const node of next.graph.nodes) {
    const { feedback } = node
    const prevLength = prevNodes.get(node.id)?.feedback.length ?? 0
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
  return events
}

function gateChanges(prev: Observation, next: Observation): FactoryEvent[] {
  const events: FactoryEvent[] = []
  const prevGateNodes = gateNodeIds(prev.waiting, prev.graph)
  const nextGateNodes = gateNodeIds(next.waiting, next.graph)
  for (const nodeId of nextGateNodes) {
    if (!prevGateNodes.has(nodeId)) events.push({ kind: 'gate', nodeId, waiting: true })
  }
  for (const nodeId of prevGateNodes) {
    if (!nextGateNodes.has(nodeId)) events.push({ kind: 'gate', nodeId, waiting: false })
  }
  return events
}

function ciRoundChanges(prev: Observation, next: Observation): FactoryEvent[] {
  if (next.ci === null || (prev.ci !== null && next.ci.round <= prev.ci.round)) return []
  return [{ kind: 'ci-round', round: next.ci.round, max: next.ci.max }]
}

function ciCheckChanges(prev: Observation, next: Observation): FactoryEvent[] {
  if (next.ci === null) return []
  const events: FactoryEvent[] = []
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
  return events
}

function queueChanges(prev: Observation, next: Observation): FactoryEvent[] {
  const queue = next.queue
  if (queue === null) return []
  const changed =
    prev.queue === null ||
    prev.queue.position !== queue.position ||
    prev.queue.behind.length !== queue.behind.length ||
    prev.queue.behind.some((entry, index) => entry.orderId !== queue.behind[index]?.orderId)
  if (!changed) return []
  return [
    { kind: 'queued', position: queue.position, behind: queue.behind.map((entry) => entry.title) },
  ]
}

/** In the order a diff reports them. */
const CHANGE_READERS: readonly ChangeReader[] = [
  stateChanges,
  orphanChanges,
  strandedChanges,
  toolChanges,
  handoffChanges,
  reworkChanges,
  gateChanges,
  ciRoundChanges,
  ciCheckChanges,
  queueChanges,
]

function name(labels: Readonly<Record<string, string>>, nodeId: string): string {
  return labels[nodeId] ?? nodeId
}

/** One kind of event in words, given how to name a node. */
type Describer<K extends FactoryEvent['kind']> = (
  event: Extract<FactoryEvent, { kind: K }>,
  named: (nodeId: string) => string
) => string

/** Each kind of event in words — a kind this lacks is a compile error. */
const DESCRIBE: { readonly [K in FactoryEvent['kind']]: Describer<K> } = {
  'node-state': (event, named) => `${named(event.nodeId)} is now ${event.to}.`,
  orphaned: (event, named) => `${named(event.nodeId)}'s agent is gone.`,
  stranded: (event, named) =>
    event.on
      ? `${named(event.nodeId)} is waiting on you.`
      : `${named(event.nodeId)} is back to work.`,
  tool: (event, named) =>
    event.open
      ? `${named(event.nodeId)} is using the ${event.prop}.`
      : `${named(event.nodeId)} is done with the ${event.prop}.`,
  handoff: (event, named) => `${named(event.fromNodeId)} handed off to ${named(event.toNodeId)}.`,
  gate: (event, named) =>
    event.waiting
      ? `${named(event.nodeId)} is waiting at the gate.`
      : `${named(event.nodeId)}'s gate cleared.`,
  rework: (event, named) =>
    `${named(event.fromNodeId)} sent ${named(event.toNodeId)} back (round ${event.round}).`,
  'ci-round': (event) => `CI round ${event.round} of ${event.max}.`,
  'ci-check': (event) => `${event.name} is now ${event.bucket}.`,
  queued: (event) =>
    event.behind.length === 0
      ? `Queued ${ordinal(event.position)}.`
      : `Queued ${ordinal(event.position)}, behind ${event.behind.join(', ')}.`,
}

export function describeEvent(
  event: FactoryEvent,
  labels: Readonly<Record<string, string>>
): string {
  const describe = DESCRIBE[event.kind] as Describer<FactoryEvent['kind']>
  return describe(event, (nodeId) => name(labels, nodeId))
}
