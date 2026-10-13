import { gateNodeId, nodeOfSession } from './events.js'
import type { FactoryEvent, ToolProp } from './events.js'
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

type CalloutTone = 'start' | 'done' | 'fail' | 'tool' | 'handoff'

export interface Callout {
  readonly id: string
  readonly nodeId: string
  readonly tone: CalloutTone
  readonly text: string
  readonly at: number
}

/**
 * The pinned wait's id: one at a time, so it keeps its place in a stack.
 * @internal
 */
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

function callout(nodeId: string, { tone, text }: Said, at: number): Callout {
  return { id: `${nodeId}@${at}`, nodeId, tone, text, at }
}

/** What a callout says, and in what tone. */
interface Said {
  readonly tone: CalloutTone
  readonly text: string
}

/** A callout to raise, before it has a moment: which station, and what it says. */
type Raised = (Said & { readonly nodeId: string }) | null

const STATE_SAYS: Readonly<Record<NodeState, Said | null>> = {
  running: { tone: 'start', text: 'Started' },
  passed: { tone: 'done', text: 'Done' },
  failed: { tone: 'fail', text: 'Failed' },
  blocked: { tone: 'fail', text: 'Blocked' },
  skipped: { tone: 'done', text: 'Skipped' },
  waiting: null,
}

/** Edits happen at the desk all the time; the lit screen already says so. */
const TOOL_SAYS: Readonly<Record<ToolProp, Said | null>> = {
  archive: { tone: 'tool', text: 'Reading files' },
  rack: { tone: 'tool', text: 'Running a command' },
  desk: null,
}

const CHECK_SAYS: Readonly<Record<Check['bucket'], Said | null>> = {
  fail: { tone: 'fail', text: 'failed' },
  cancel: { tone: 'fail', text: 'failed' },
  pass: { tone: 'done', text: 'passed' },
  pending: null,
  skipping: null,
}

function onStation(nodeId: string, said: Said | null): Raised {
  return said === null ? null : { nodeId, ...said }
}

/** The callout one kind of event raises, given how to name a node. */
type Raiser<K extends FactoryEvent['kind']> = (
  event: Extract<FactoryEvent, { kind: K }>,
  named: (nodeId: string) => string
) => Raised

const RAISE: { readonly [K in FactoryEvent['kind']]: Raiser<K> } = {
  'node-state': (event) => onStation(event.nodeId, STATE_SAYS[event.to]),
  orphaned: (event) => onStation(event.nodeId, { tone: 'fail', text: 'Agent gone' }),
  // Going quiet at a terminal is an interruption, pinned rather than raised.
  stranded: (event) =>
    event.on ? null : onStation(event.nodeId, { tone: 'start', text: 'Back to work' }),
  tool: (event) => (event.open ? onStation(event.nodeId, TOOL_SAYS[event.prop]) : null),
  handoff: (event, named) =>
    onStation(event.toNodeId, { tone: 'handoff', text: `Work in from ${named(event.fromNodeId)}` }),
  gate: (event) =>
    event.waiting ? null : onStation(event.nodeId, { tone: 'done', text: 'Gate cleared' }),
  rework: (event, named) =>
    onStation(event.toNodeId, {
      tone: 'fail',
      text: `Sent back: ${named(event.fromNodeId)} failed`,
    }),
  'ci-round': (event) =>
    onStation(DISPATCH_NODE_ID, { tone: 'start', text: `Round ${event.round} of ${event.max}` }),
  'ci-check': (event) => {
    const said = CHECK_SAYS[event.bucket]
    return said === null
      ? null
      : onStation(DISPATCH_NODE_ID, { ...said, text: `${event.name} ${said.text}` })
  },
  queued: (event) =>
    onStation(DISPATCH_NODE_ID, {
      tone: 'start',
      text:
        event.behind.length === 0
          ? `Queued ${ordinal(event.position)}`
          : `Queued ${ordinal(event.position)} behind ${event.behind[event.behind.length - 1]}`,
    }),
}

/**
 * The callout an event raises, or null for a move nobody needs to see.
 *
 * Short on purpose: the station's nameplate already says which step it is,
 * so the callout only says what just happened to it.
 * @internal
 */
export function calloutFor(
  event: FactoryEvent,
  labels: Readonly<Record<string, string>>,
  at: number
): Callout | null {
  const raise = RAISE[event.kind] as Raiser<FactoryEvent['kind']>
  const raised = raise(event, (nodeId) => name(labels, nodeId))
  return raised === null ? null : callout(raised.nodeId, raised, at)
}

/** A held tool call, as the permissions list reports it. */
interface HeldCall {
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
  return [...asksOf(input), ...gatesOf(input), ...parkedOf(input)]
}

/** The held tool calls, each over its agent's station. */
function asksOf(input: InterruptionInput): Interruption[] {
  return input.pending.map((call) => ({
    kind: 'ask',
    id: call.requestId,
    nodeId: nodeOfSession(input.graph, call.sessionId),
    title: `Wants to run ${call.toolName}`,
    detail: call.summary,
    prose: call.toolName === 'AskUserQuestion',
  }))
}

/** The gates waiting on the operator, each over the station it holds. */
function gatesOf(input: InterruptionInput): Interruption[] {
  return input.waiting.map((gate) => ({
    kind: 'gate',
    id: gate.id,
    nodeId: gateNodeId(gate, input.graph),
    title: gate.summary,
    detail: gate.why,
    gate,
  }))
}

/** The agents parked at their terminal's own prompt, unless a held call already says so. */
function parkedOf(input: InterruptionInput): Interruption[] {
  // A held call already says its agent is stopped; saying it twice is noise.
  const asking = new Set(input.pending.map((call) => call.sessionId))
  return input.stranded
    .filter((sessionId) => !asking.has(sessionId))
    .map((sessionId) => ({
      kind: 'stranded',
      id: sessionId,
      nodeId: nodeOfSession(input.graph, sessionId),
      title: 'Waiting at its terminal',
      detail: 'A question went unanswered in time. Answer it in the terminal.',
    }))
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
  {
    obstacles,
    kept,
  }: { readonly obstacles: readonly Obstacle[]; readonly kept: Readonly<Record<string, number>> },
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
    case 'running':
      return 'Working'
    case 'passed':
      return 'Done'
    case 'failed':
      return 'Failed'
    case 'blocked':
      return 'Blocked'
    case 'skipped':
      return 'Skipped'
    default: {
      const never: never = state
      throw new Error(`unhandled node state: ${String(never)}`)
    }
  }
}
