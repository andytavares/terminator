import { gateNodeId } from './events.js'
import type { FactoryEvent } from './events.js'
import { ordinal } from './format.js'
import type { Gate } from '../gates/rules.js'
import type { NodeState, RunGraph } from '../line/run-graph.js'
import { DISPATCH_NODE_ID } from './layout.js'
import { tallyChecks, waitingOnChecks } from './ci-tally.js'
import type { Check } from '../line/ci.js'

// What the hall says, and where it says it.
//
// Status belongs at the station it is about, not in a line of text under the
// picture: a callout rises from the station where something happened, and an
// interruption is pinned over the station that is waiting on you. Both are
// derived here, purely, so the surface only decides how they look.

export type CalloutTone = 'start' | 'done' | 'fail' | 'tool' | 'handoff'

export interface Callout {
  readonly id: string
  readonly nodeId: string
  readonly tone: CalloutTone
  readonly text: string
  readonly at: number
}

/** The pinned wait's id: one at a time, so it keeps its place in a stack. */
export const CI_WAITING_ID = 'ci-waiting'

/**
 * The callout that stays pinned to the tower for as long as any check is
 * pending: "Waiting on checks · 12 of 19 done". Unlike a raised callout it has
 * no time to leave in; it goes when the last check lands. Null otherwise.
 */
export function ciWaitingCallout(
  ci: { readonly pulls: readonly { readonly checks: readonly Pick<Check, 'bucket'>[] }[] } | null
): Callout | null {
  if (ci === null) return null
  const text = waitingOnChecks(tallyChecks(ci.pulls.flatMap((p) => p.checks.map((c) => c.bucket))))
  return text === null
    ? null
    : { id: CI_WAITING_ID, nodeId: DISPATCH_NODE_ID, tone: 'start', text, at: 0 }
}

function name(labels: Readonly<Record<string, string>>, nodeId: string): string {
  return labels[nodeId] ?? nodeId
}

function callout(nodeId: string, tone: CalloutTone, text: string, at: number): Callout {
  return { id: `${nodeId}@${at}`, nodeId, tone, text, at }
}

/**
 * The callout an event raises, or null for a move nobody needs to see.
 *
 * Short on purpose: the station's nameplate already says which step it is,
 * so the callout only says what just happened to it.
 */
export function calloutFor(
  event: FactoryEvent,
  labels: Readonly<Record<string, string>>,
  at: number
): Callout | null {
  switch (event.kind) {
    case 'node-state':
      switch (event.to) {
        case 'running':
          return callout(event.nodeId, 'start', 'Started', at)
        case 'verifying':
          return callout(event.nodeId, 'start', 'Checking', at)
        case 'passed':
          return callout(event.nodeId, 'done', 'Done', at)
        case 'failed':
          return callout(event.nodeId, 'fail', 'Failed', at)
        case 'blocked':
          return callout(event.nodeId, 'fail', 'Blocked', at)
        case 'skipped':
          return callout(event.nodeId, 'done', 'Skipped', at)
        case 'waiting':
        case 'ready':
          return null
        /* v8 ignore next 3 -- exhaustive union, unreachable */
        default: {
          const never: never = event.to
          throw new Error(`unhandled node state: ${String(never)}`)
        }
      }
    case 'orphaned':
      return callout(event.nodeId, 'fail', 'Agent gone', at)
    case 'stranded':
      // Going quiet at a terminal is an interruption, pinned rather than raised.
      return event.on ? null : callout(event.nodeId, 'start', 'Back to work', at)
    case 'tool':
      if (!event.open) return null
      switch (event.prop) {
        case 'archive':
          return callout(event.nodeId, 'tool', 'Reading files', at)
        case 'rack':
          return callout(event.nodeId, 'tool', 'Running a command', at)
        case 'desk':
          // Edits happen at the desk all the time; the lit screen already says so.
          return null
        /* v8 ignore next 3 -- exhaustive union, unreachable */
        default: {
          const never: never = event.prop
          throw new Error(`unhandled tool prop: ${String(never)}`)
        }
      }
    case 'handoff':
      return callout(
        event.toNodeId,
        'handoff',
        `Work in from ${name(labels, event.fromNodeId)}`,
        at
      )
    case 'gate':
      return event.waiting ? null : callout(event.nodeId, 'done', 'Gate cleared', at)
    case 'rework':
      return callout(
        event.toNodeId,
        'fail',
        `Sent back: ${name(labels, event.fromNodeId)} failed`,
        at
      )
    case 'ci-round':
      return callout(DISPATCH_NODE_ID, 'start', `Round ${event.round} of ${event.max}`, at)
    case 'ci-check':
      switch (event.bucket) {
        case 'fail':
        case 'cancel':
          return callout(DISPATCH_NODE_ID, 'fail', `${event.name} failed`, at)
        case 'pass':
          return callout(DISPATCH_NODE_ID, 'done', `${event.name} passed`, at)
        case 'pending':
        case 'skipping':
          return null
        /* v8 ignore next 3 -- exhaustive union, unreachable */
        default: {
          const never: never = event.bucket
          throw new Error(`unhandled check bucket: ${String(never)}`)
        }
      }
    case 'queued':
      return callout(
        DISPATCH_NODE_ID,
        'start',
        event.behind.length === 0
          ? `Queued ${ordinal(event.position)}`
          : `Queued ${ordinal(event.position)} behind ${event.behind[event.behind.length - 1]}`,
        at
      )
    /* v8 ignore next 3 -- exhaustive union, unreachable */
    default: {
      const never: never = event
      throw new Error(`unhandled factory event: ${String(never)}`)
    }
  }
}

/** A held tool call, as the permissions list reports it. */
export interface HeldCall {
  readonly requestId: string
  readonly sessionId: string
  readonly toolName: string
  readonly summary: string
}

export type Interruption =
  | {
      readonly kind: 'ask'
      readonly id: string
      readonly nodeId: string | null
      readonly title: string
      readonly detail: string
      /** An agent's question is prose and shown as markdown; any other tool's input is literal. */
      readonly prose: boolean
    }
  | {
      readonly kind: 'gate'
      readonly id: string
      readonly nodeId: string | null
      readonly title: string
      readonly detail: string
      /** The gate itself, so a surface can draw it with its own answers. */
      readonly gate: Gate
    }
  | {
      readonly kind: 'stranded'
      readonly id: string
      readonly nodeId: string | null
      readonly title: string
      readonly detail: string
    }

export interface InterruptionInput {
  readonly graph: RunGraph
  readonly waiting: readonly Gate[]
  readonly stranded: readonly string[]
  readonly pending: readonly HeldCall[]
}

/** Everything in this hall waiting on the operator, each pinned to a station where one owns it. */
export function interruptionsFor(input: InterruptionInput): Interruption[] {
  const nodeOfSession = (sessionId: string): string | null =>
    input.graph.nodes.find((n) => n.sessionId === sessionId)?.id ?? null

  const asks: Interruption[] = input.pending.map((call) => ({
    kind: 'ask',
    id: call.requestId,
    nodeId: nodeOfSession(call.sessionId),
    title: `Wants to run ${call.toolName}`,
    detail: call.summary,
    prose: call.toolName === 'AskUserQuestion',
  }))

  const gates: Interruption[] = input.waiting.map((gate) => ({
    kind: 'gate',
    id: gate.id,
    nodeId: gateNodeId(gate, input.graph),
    title: gate.summary,
    detail: gate.why,
    gate,
  }))

  // A held call already says its agent is stopped; saying it twice is noise.
  const asking = new Set(input.pending.map((call) => call.sessionId))
  const parked: Interruption[] = input.stranded
    .filter((sessionId) => !asking.has(sessionId))
    .map((sessionId) => ({
      kind: 'stranded',
      id: sessionId,
      nodeId: nodeOfSession(sessionId),
      title: 'Waiting at its terminal',
      detail: 'A question went unanswered in time. Answer it in the terminal.',
    }))

  return [...asks, ...gates, ...parked]
}

/** How loudly a callout's tone speaks when one station has several things to say. */
const TONE_WEIGHT: Readonly<Record<CalloutTone, number>> = {
  fail: 2,
  done: 1,
  start: 0,
  tool: 0,
  handoff: 0,
}

/**
 * The callouts a poll's events raise: one per station, since a station has
 * one patch of air above it. A failure outranks anything else; otherwise the
 * latest event speaks.
 */
export function calloutsFor(
  events: readonly FactoryEvent[],
  labels: Readonly<Record<string, string>>,
  at: number
): Callout[] {
  const byNode = new Map<string, Callout>()
  for (const event of events) {
    const raised = calloutFor(event, labels, at)
    if (raised === null) continue
    const held = byNode.get(raised.nodeId)
    if (held !== undefined && TONE_WEIGHT[held.tone] > TONE_WEIGHT[raised.tone]) continue
    byNode.delete(raised.nodeId)
    byNode.set(raised.nodeId, raised)
  }
  return [...byNode.values()]
}

/** A raised callout's size, and where its bottom-centre sits on the ground level. */
export interface CalloutBox {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** Something already on the hall a callout must not cover, such as a nameplate. */
export interface Obstacle {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** A stack taller than this is off the top of any hall; the last level is used. */
const MAX_LEVEL = 12

function overlaps(a: Obstacle, b: Obstacle): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/**
 * How many `pitch`es each callout is lifted so none covers another or a
 * nameplate, in the order they were raised.
 *
 * A callout in `kept` holds its level, so it never jumps when an older one
 * leaves; each new one takes the lowest level at which it is clear.
 */
export function calloutLevels(
  boxes: readonly CalloutBox[],
  obstacles: readonly Obstacle[],
  kept: Readonly<Record<string, number>>,
  pitch: number
): Record<string, number> {
  const at = (box: CalloutBox, level: number): Obstacle => {
    const bottom = box.y - level * pitch
    return { left: box.x - box.w / 2, top: bottom - box.h, right: box.x + box.w / 2, bottom }
  }
  const levels: Record<string, number> = {}
  const placed: Obstacle[] = [...obstacles]
  for (const box of boxes) {
    const held = kept[box.id]
    if (held !== undefined) {
      levels[box.id] = held
      placed.push(at(box, held))
    }
  }
  for (const box of boxes) {
    if (levels[box.id] !== undefined) continue
    let level = 0
    while (level < MAX_LEVEL && placed.some((other) => overlaps(at(box, level), other))) level++
    levels[box.id] = level
    placed.push(at(box, level))
  }
  return levels
}

/** The one word a nameplate spends on where a step stands. */
export function stateWord(state: NodeState): string {
  switch (state) {
    case 'waiting':
      return 'Queued'
    case 'ready':
      return 'Ready'
    case 'running':
      return 'Working'
    case 'verifying':
      return 'Checking'
    case 'passed':
      return 'Done'
    case 'failed':
      return 'Failed'
    case 'blocked':
      return 'Blocked'
    case 'skipped':
      return 'Skipped'
    /* v8 ignore next 3 -- exhaustive union, unreachable */
    default: {
      const never: never = state
      throw new Error(`unhandled node state: ${String(never)}`)
    }
  }
}
