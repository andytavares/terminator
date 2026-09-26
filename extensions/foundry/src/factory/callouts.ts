import { gateNodeId } from './events.js'
import type { FactoryEvent } from './events.js'
import type { Gate, GateOption } from '../gates/rules.js'
import type { NodeState, RunGraph } from '../line/run-graph.js'

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
      readonly options: readonly GateOption[]
      /** A budget raise needs a number typed, which the Inbox's form does. */
      readonly needsInbox: boolean
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
    options: gate.options,
    needsInbox: gate.breach != null,
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
