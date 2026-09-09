import type { Gate } from '../gates/rules.js'
import type { RunGraph } from '../line/run-graph.js'
import type { WorkOrder } from './schema.js'

// What an order is doing, and whose move it is.
//
// One derivation, read by every surface, because the alternative was tried:
// each surface worked the answer out from whatever it happened to hold. The
// order list read a draft-time compile result — which is zero for every
// running order, for ever — and so told the operator that a run halted two
// hours earlier at an undecided gate was "ready to hand off". The Floor read
// the graph alone and drew a `building` chip for an agent sitting at a
// terminal prompt. Neither named the gate, and the gate was the only thing
// that would have moved the order forward.
//
// Deliberately pure and deliberately ignorant of the UI: it says what the
// state is and which gate is holding it, and each surface decides what
// controls that deserves.

export type StandingKind =
  | 'shaping'
  | 'ready'
  | 'working'
  | 'asking'
  | 'stranded'
  | 'halted'
  | 'stalled'
  | 'adrift'
  | 'failed'
  | 'done'

/**
 * Who the order is waiting on.
 *
 * The only thing a badge needs in order to decide whether to be loud.
 */
export type Turn = 'you' | 'foundry'

export interface Standing {
  readonly kind: StandingKind
  readonly turn: Turn
  /** A few words, for a row that has one line to spend. */
  readonly label: string
  /**
   * The same thing at the top of a screen, in sentence case.
   *
   * Carried here rather than looked up in the surface from `kind`, because a
   * lookup table keyed by a union blanks the whole panel the day the union
   * gains a member: React is handed `undefined`, it throws, everything below
   * unmounts, and the build, the lint and every test stay green.
   */
  readonly headline: string
  /** One sentence: what this state is, and what put it there. */
  readonly detail: string
  /** Steps that will not run again, out of every step in the graph. */
  readonly done: number
  readonly total: number
  /** The gate holding this order, when one is. */
  readonly gateId: string | null
}

export interface StandingInput {
  readonly status: WorkOrder['status']
  /** Null before the line has built one, or when it cannot be read. */
  readonly graph: RunGraph | null
  /** Gates raised against this order. Decided ones are history and ignored. */
  readonly gates: readonly Gate[]
  /** Tool calls this order's agents are holding, waiting to be answered. */
  readonly asks: number
  /** Node ids the graph calls running that nothing is actually running. */
  readonly orphaned: readonly string[]
  /** Runs the stall detector has fired on. */
  readonly stalls: number
  /** Questions the Forge is still asking. Draft orders only. */
  readonly openQuestions: number
  /** Compile checks a draft has not cleared. Draft orders only. */
  readonly failures: number
  /**
   * Agents whose tool call was handed back to the terminal's own prompt.
   *
   * The bridge does this when nobody answers in time. An unattended run never
   * reaches that prompt, so the agent stops there — with its process alive and
   * its node still `running`, which is indistinguishable from working.
   */
  readonly stranded: number
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/**
 * The standing of an order.
 *
 * Ordered worst-first, and the order is not arbitrary: it is how much of the
 * run each condition has stopped. A gate halts the whole line, so it outranks
 * a held tool call, which stops one agent — and a run can be in both at once,
 * which is exactly the case that produced a screen naming neither.
 */
export function standingOf(input: StandingInput): Standing {
  const nodes = input.graph?.nodes ?? []
  const total = nodes.length
  const done = nodes.filter((n) => n.state === 'passed' || n.state === 'skipped').length
  const running = nodes.filter((n) => n.state === 'running' || n.state === 'verifying').length
  const failed = nodes.filter((n) => n.state === 'failed').length
  const counts = { done, total, gateId: null }

  if (input.status === 'shipped') {
    return {
      ...counts,
      kind: 'done',
      turn: 'foundry',
      label: 'shipped',
      headline: 'Shipped',
      detail: 'This order shipped. Nothing is left to do.',
    }
  }

  if (input.status === 'draft') {
    const open = input.openQuestions
    return open > 0
      ? {
          ...counts,
          kind: 'shaping',
          turn: 'you',
          label: `${open} to answer`,
          headline: `${open} ${plural(open, 'question', 'questions')} to answer`,
          detail: `${open} ${plural(open, 'question', 'questions')} to answer before this can start.`,
        }
      : {
          ...counts,
          kind: 'shaping',
          turn: 'foundry',
          label: 'being shaped',
          headline: 'Being shaped',
          detail:
            input.failures === 0
              ? 'Foundry has shaped this and every check passes. It starts on its own.'
              : `Foundry is still shaping this — ${input.failures} ${plural(input.failures, 'check has', 'checks have')} yet to clear.`,
        }
  }

  // Halted before anything else. Nothing the line does next is scheduled until
  // this is answered, so every other condition below is a symptom of it.
  const holding = input.gates.find((gate) => gate.decision === null)
  if (holding !== undefined) {
    return {
      ...counts,
      kind: 'halted',
      turn: 'you',
      gateId: holding.id,
      label: 'halted',
      headline: 'Halted — your move',
      detail: 'The line stopped at a gate. Nothing moves until you answer it.',
    }
  }

  if (input.orphaned.length > 0) {
    const n = input.orphaned.length
    return {
      ...counts,
      kind: 'adrift',
      turn: 'you',
      label: 'nothing running it',
      headline: 'Nothing is running this',
      detail: `${n} ${plural(n, 'step was', 'steps were')} still working when the application last closed, and an agent's terminal does not outlive it.`,
    }
  }

  if (input.asks > 0) {
    const n = input.asks
    return {
      ...counts,
      kind: 'asking',
      turn: 'you',
      label: plural(n, 'an agent is asking', `${n} agents are asking`),
      headline: plural(n, 'An agent is asking you', `${n} agents are asking you`),
      detail: `${n} ${plural(n, 'agent has', 'agents have')} stopped at a tool call and cannot go on until you allow or refuse it.`,
    }
  }

  // After `asking` deliberately: a held call is answerable from the surface in
  // one click, and this one can only be answered by going to the terminal.
  if (input.stranded > 0) {
    const n = input.stranded
    return {
      ...counts,
      kind: 'stranded',
      turn: 'you',
      label: plural(n, 'waiting at its terminal', `${n} waiting at their terminals`),
      headline: plural(
        n,
        'An agent is waiting at its terminal',
        `${n} agents are waiting at their terminals`
      ),
      detail: `Nobody answered in time, so Foundry handed the question back to the terminal's own prompt. ${plural(n, 'That agent is', 'Those agents are')} stopped there until somebody answers it in the terminal.`,
    }
  }

  if (input.stalls > 0) {
    const n = input.stalls
    return {
      ...counts,
      kind: 'stalled',
      turn: 'you',
      label: 'stalled',
      headline: 'Stopped making progress',
      detail: `${n} ${plural(n, 'run', 'runs')} stopped making progress without asking for anything.`,
    }
  }

  if (failed > 0) {
    return {
      ...counts,
      kind: 'failed',
      turn: 'you',
      label: `${failed} failed`,
      headline: `${failed} ${plural(failed, 'step', 'steps')} failed`,
      detail: `${failed} ${plural(failed, 'step', 'steps')} failed and ${plural(failed, 'is', 'are')} waiting on what you want done about it.`,
    }
  }

  // No graph is not "0 of 0 steps done", which reads as finished. It is an
  // order the line has not picked up yet.
  if (total === 0) {
    return {
      ...counts,
      kind: 'ready',
      turn: 'foundry',
      label: 'starting',
      headline: 'Starting',
      detail: 'Agreed, and waiting for the line to pick it up.',
    }
  }

  return {
    ...counts,
    kind: 'working',
    turn: 'foundry',
    label: `building ${done}/${total}`,
    headline: running === 0 ? 'Between steps' : 'Building',
    detail:
      running === 0
        ? `${done} of ${total} steps done. Nothing is running right now.`
        : `${running} ${plural(running, 'agent is', 'agents are')} working — ${done} of ${total} steps done.`,
  }
}

/**
 * Where each fact about an order comes from.
 *
 * Functions rather than values because none of these live in one place: the
 * graph is a file, the gates are another, and whether an agent is actually
 * alive is a runtime question no record on disk can answer. Every one is
 * optional, and a host that supplies none still gets a standing — a surface
 * that renders an empty band is the defect this module exists to remove.
 */
export interface StandingSources {
  readonly graphFor?: (orderId: string) => Promise<RunGraph | null>
  readonly gatesFor?: (orderId: string) => Promise<readonly Gate[]>
  readonly asksFor?: (orderId: string) => number
  readonly stallsFor?: (orderId: string) => number
  /** Nodes the graph calls running that nothing is running. */
  readonly orphansFor?: (orderId: string, graph: RunGraph) => readonly string[]
  /** Questions the Forge is still putting to the operator. */
  readonly openQuestionsFor?: (order: WorkOrder) => number
  /** Compile checks the order has not cleared. */
  readonly failuresFor?: (order: WorkOrder) => number
  /** Agents of this order parked at their terminal's own prompt. */
  readonly strandedFor?: (orderId: string) => number
}

/**
 * Read an order's standing.
 *
 * The one place the inputs are assembled. Two callers assembling them
 * separately is how the order list and the Floor came to describe the same
 * halted run as "ready to hand off" and "building" at the same moment.
 */
export async function readStanding(order: WorkOrder, sources: StandingSources): Promise<Standing> {
  const graph = (await sources.graphFor?.(order.id)) ?? null
  return standingOf({
    status: order.status,
    graph,
    gates: (await sources.gatesFor?.(order.id)) ?? [],
    asks: sources.asksFor?.(order.id) ?? 0,
    orphaned: graph === null ? [] : (sources.orphansFor?.(order.id, graph) ?? []),
    stalls: sources.stallsFor?.(order.id) ?? 0,
    openQuestions: sources.openQuestionsFor?.(order) ?? 0,
    failures: sources.failuresFor?.(order) ?? 0,
    stranded: sources.strandedFor?.(order.id) ?? 0,
  })
}
