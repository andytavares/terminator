import type { Gate } from '../gates/rules.js'
import type { RunGraph } from '../line/run-graph.js'
import { nodeLabel } from '../line/run-graph.js'
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

type StandingKind =
  | 'shaping'
  | 'ready'
  | 'working'
  | 'asking'
  | 'stranded'
  | 'halted'
  | 'stalled'
  | 'adrift'
  | 'failed'
  | 'stopped'
  | 'done'

/**
 * Who the order is waiting on.
 *
 * The only thing a badge needs in order to decide whether to be loud.
 */
type Turn = 'you' | 'foundry'

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

/** @internal */
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
   * Why the last intake turn was refused, when it was. Draft orders only.
   *
   * A refusal moves nothing: the proposal failed validation, so there is no
   * redraft to save and the document is byte-for-byte what it was. Without
   * this the standing of such an order is indistinguishable from one an
   * architect is still working on, and it said so — "Foundry is still shaping
   * this" about an order nothing had touched for an hour.
   */
  readonly intakeRefused: string | null
  /**
   * Why the run last stopped on an error or refused to ship, when it did.
   * Running orders only.
   *
   * A run can finish its whole graph and still fail — the WO-0913-0bd case:
   * every node passed, but opening the pull request threw, and the ledger
   * carries the only record of that. Without this the standing of such a run
   * is indistinguishable from one between steps, and it said so — "Nothing is
   * running right now" about a run that had stopped for good.
   */
  readonly runFailure: string | null
  /**
   * Agents whose tool call was handed back to the terminal's own prompt.
   *
   * The bridge does this when nobody answers in time. An unattended run never
   * reaches that prompt, so the agent stops there — with its process alive and
   * its node still `running`, which is indistinguishable from working.
   */
  readonly stranded: number
  /**
   * Where the document is, when the run ended on one. Running orders only.
   *
   * A document outside the checkout has no pull request, so the run finishes
   * without shipping anything. That is the end of the work, not a refusal to
   * ship it.
   */
  readonly documentReady?: string | null
  /**
   * Whether an architect or red-team turn is live on this draft, or Foundry is
   * deciding what to start next. Draft orders only.
   *
   * Without it a draft that every turn had finished with read exactly like one
   * being worked: WO-1008-287 was amended, passed every check, and sat for
   * good under "It starts on its own" — nothing starts a draft on its own.
   */
  readonly shaping: boolean
  /** The first check a draft has not cleared, in words. Draft orders only. */
  readonly blocker: string | null
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/** What every rule below reads off the graph and the gates, worked out once. */
interface Facts {
  readonly nodes: readonly RunGraph['nodes'][number][]
  readonly running: number
  readonly failed: number
  readonly counts: Pick<Standing, 'done' | 'total' | 'gateId'>
  /** The first gate nobody has decided yet. */
  readonly holding: Gate | undefined
}

function factsOf(input: StandingInput): Facts {
  const nodes = input.graph?.nodes ?? []
  const done = nodes.filter((n) => n.state === 'passed' || n.state === 'skipped').length
  return {
    nodes,
    running: nodes.filter((n) => n.state === 'running').length,
    failed: nodes.filter((n) => n.state === 'failed').length,
    counts: { done, total: nodes.length, gateId: null },
    holding: input.gates.find((gate) => gate.decision === null),
  }
}

/** One condition an order can be in: its standing when the order is in it, otherwise null. */
type Rule = (input: StandingInput, facts: Facts) => Standing | null

/**
 * The standing of an order.
 *
 * Ordered worst-first, and the order is not arbitrary: it is how much of the
 * run each condition has stopped. A gate halts the whole line, so it outranks
 * a held tool call, which stops one agent — and a run can be in both at once,
 * which is exactly the case that produced a screen naming neither.
 * @internal
 */
export function standingOf(input: StandingInput): Standing {
  const facts = factsOf(input)
  for (const rule of RULES) {
    const standing = rule(input, facts)
    if (standing !== null) return standing
  }
  return working(facts)
}

// A shipped order can still wait: the draft's ready-for-review gate opens after the
// work, and it is the operator's.
const shipped: Rule = (input, { counts, holding }) => {
  if (input.status !== 'shipped') return null
  if (holding !== undefined) {
    return {
      ...counts,
      kind: 'halted',
      turn: 'you',
      gateId: holding.id,
      label: holding.summary,
      headline: `Shipped — ${holding.summary}`,
      detail: 'The work shipped. One decision is still open, and it is yours.',
    }
  }
  return {
    ...counts,
    kind: 'done',
    turn: 'foundry',
    label: 'shipped',
    headline: 'Shipped',
    detail: 'This order shipped. Nothing is left to do.',
  }
}

const draft: Rule = (input, { counts }) => {
  if (input.status !== 'draft') return null
  const shaping = (over: Omit<Standing, 'kind' | 'done' | 'total' | 'gateId'>): Standing => ({
    ...counts,
    kind: 'shaping',
    ...over,
  })
  return (
    refusedDraft(input, shaping) ??
    questionedDraft(input, shaping) ??
    (input.shaping ? beingShaped(input, shaping) : idleDraft(input, shaping))
  )
}

type Shaping = (over: Omit<Standing, 'kind' | 'done' | 'total' | 'gateId'>) => Standing

// Ahead of the open questions, because a refused turn is why they are open: answers
// are not picked up until intake runs again.
function refusedDraft(input: StandingInput, shaping: Shaping): Standing | null {
  if (input.intakeRefused === null) return null
  return shaping({
    turn: 'you',
    label: 'intake was refused',
    headline: 'The architect’s plan was refused',
    detail: `Nothing was changed: ${input.intakeRefused}`,
  })
}

function questionedDraft(input: StandingInput, shaping: Shaping): Standing | null {
  const open = input.openQuestions
  if (open <= 0) return null
  const questions = `${open} ${plural(open, 'question', 'questions')} to answer`
  return shaping({
    turn: 'you',
    label: `${open} to answer`,
    headline: questions,
    detail: `${questions} before this can start.`,
  })
}

function checksLeft(input: StandingInput): string {
  return `${input.failures} ${plural(input.failures, 'check has', 'checks have')} yet to clear`
}

function beingShaped(input: StandingInput, shaping: Shaping): Standing {
  return shaping({
    turn: 'foundry',
    label: 'being shaped',
    headline: 'Being shaped',
    detail:
      input.failures === 0
        ? 'Foundry is finishing this off. Every check passes so far.'
        : `Foundry is still shaping this — ${checksLeft(input)}.`,
  })
}

/** Nothing is working on it, so whatever happens next is the operator's. */
function idleDraft(input: StandingInput, shaping: Shaping): Standing {
  if (input.failures === 0) {
    return shaping({
      turn: 'you',
      label: 'ready to hand off',
      headline: 'Ready to hand off',
      detail: 'Every check passes. Read the plan and hand it off in the Forge to start the run.',
    })
  }
  const blocker = (input.blocker ?? 'open it in the Forge to see which').replace(/\.$/, '')
  return shaping({
    turn: 'you',
    label: 'shaping stopped',
    headline: 'Shaping stopped',
    detail: `Nothing is working on this and ${checksLeft(input)}: ${blocker}. Open it in the Forge and ask for the gap to be closed.`,
  })
}

// Halted comes first: nothing is scheduled until it is answered, so every condition
// below is a symptom of it.
const halted: Rule = (_input, { counts, holding }) => {
  if (holding === undefined) return null
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

const adrift: Rule = (input, { counts }) => {
  const n = input.orphaned.length
  if (n === 0) return null
  return {
    ...counts,
    kind: 'adrift',
    turn: 'you',
    label: 'nothing running it',
    headline: 'Nothing is running this',
    detail: `${n} ${plural(n, 'step was', 'steps were')} still working when the application last closed, and an agent's terminal does not outlive it.`,
  }
}

const asking: Rule = (input, { counts }) => {
  const n = input.asks
  if (n <= 0) return null
  return {
    ...counts,
    kind: 'asking',
    turn: 'you',
    label: plural(n, 'an agent is asking', `${n} agents are asking`),
    headline: plural(n, 'An agent is asking you', `${n} agents are asking you`),
    detail: `${n} ${plural(n, 'agent has', 'agents have')} stopped at a tool call and cannot go on until you allow or refuse it.`,
  }
}

// After `asking` on purpose: a held call is answered in one click, this one only by
// going to the terminal.
const stranded: Rule = (input, { counts }) => {
  const n = input.stranded
  if (n <= 0) return null
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

const stalled: Rule = (input, { counts }) => {
  const n = input.stalls
  if (n <= 0) return null
  return {
    ...counts,
    kind: 'stalled',
    turn: 'you',
    label: 'stalled',
    headline: 'Stopped making progress',
    detail: `${n} ${plural(n, 'run', 'runs')} stopped making progress without asking for anything.`,
  }
}

const documentReady: Rule = (input, { counts }) => {
  if (input.documentReady === undefined || input.documentReady === null) return null
  return {
    ...counts,
    kind: 'done',
    turn: 'foundry',
    label: 'Finished · document ready',
    headline: 'Finished · document ready',
    detail: `The author handed back the document, and there is no pull request to open for it: ${input.documentReady}`,
  }
}

const runFailed: Rule = (input, { counts }) => {
  if (input.runFailure === null) return null
  const { label, headline } = howFarItGot(counts)
  return {
    ...counts,
    kind: 'stopped',
    turn: 'you',
    label,
    headline,
    detail: input.runFailure.trim() === '' ? 'It recorded no reason.' : input.runFailure,
  }
}

/** A run that stopped: before its first step, part way, or with every step done. */
function howFarItGot({ done, total }: Facts['counts']): Pick<Standing, 'label' | 'headline'> {
  if (total > 0 && done === total) {
    return { label: 'not shipped', headline: 'Finished, but not shipped' }
  }
  if (total === 0) return { label: 'did not start', headline: 'The run did not start' }
  return { label: 'stopped', headline: 'The run stopped on an error' }
}

const failedSteps: Rule = (_input, { counts, failed }) => {
  if (failed <= 0) return null
  return {
    ...counts,
    kind: 'failed',
    turn: 'you',
    label: `${failed} failed`,
    headline: `${failed} ${plural(failed, 'step', 'steps')} failed`,
    detail: `${failed} ${plural(failed, 'step', 'steps')} failed and ${plural(failed, 'is', 'are')} waiting on what you want done about it.`,
  }
}

/** No graph is an order the line has not picked up, not "0 of 0 steps done". */
const starting: Rule = (_input, { counts }) => {
  if (counts.total !== 0) return null
  return {
    ...counts,
    kind: 'ready',
    turn: 'foundry',
    label: 'starting',
    headline: 'Starting',
    detail: 'Agreed, and waiting for the line to pick it up.',
  }
}

const RULES: readonly Rule[] = [
  shipped,
  draft,
  halted,
  adrift,
  asking,
  stranded,
  stalled,
  documentReady,
  runFailed,
  failedSteps,
  starting,
]

function working({ nodes, running, counts }: Facts): Standing {
  const { done, total } = counts
  return {
    ...counts,
    kind: 'working',
    turn: 'foundry',
    label: `building ${done}/${total}`,
    headline: running === 0 ? 'Between steps' : 'Building',
    detail:
      reworkDetail(nodes) ??
      (running === 0
        ? `${done} of ${total} steps done. Nothing is running right now.`
        : `${running} ${plural(running, 'agent is', 'agents are')} working — ${done} of ${total} steps done.`),
  }
}

// A step being worked may carry a check's feedback: then the run is redoing what a
// check rejected, not merely building.
function reworkDetail(nodes: Facts['nodes']): string | null {
  const reworking = nodes.find(
    (n) => (n.state === 'running' || n.state === 'waiting') && (n.feedback?.length ?? 0) > 0
  )
  if (reworking === undefined) return null
  const latest = reworking.feedback[reworking.feedback.length - 1]
  const fromNode = nodes.find((n) => n.id === latest.from)
  const label = fromNode === undefined ? latest.from : nodeLabel(null, fromNode)
  return `Reworking after ${label} failed.`
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
  /** Why this order's last intake turn was refused, when it was. */
  readonly intakeRefusedFor?: (orderId: string) => Promise<string | null>
  /** Why this order's run last stopped on an error or refused to ship. */
  readonly runFailureFor?: (orderId: string) => Promise<string | null>
  /** Where this order's run left its document, when it ended on one. */
  readonly documentReadyFor?: (orderId: string) => Promise<string | null>
  /** Whether anything is still shaping this draft. Unknown reads as yes. */
  readonly shapingFor?: (orderId: string) => Promise<boolean>
  /** The first check this order has not cleared, in words. */
  readonly blockerFor?: (order: WorkOrder) => string | null
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
    orphaned: graph === null ? [] : (sources.orphansFor?.(order.id, graph) ?? []),
    ...heldCounts(order, sources),
    ...openCounts(order, sources),
    ...(await draftFacts(order, sources)),
    ...(await runFacts(order, sources)),
  })
}

/** What the Forge still has open on this order: questions, and checks not cleared. */
function openCounts(
  order: WorkOrder,
  sources: StandingSources
): Pick<StandingInput, 'openQuestions' | 'failures'> {
  return {
    openQuestions: sources.openQuestionsFor?.(order) ?? 0,
    failures: sources.failuresFor?.(order) ?? 0,
  }
}

/** The agents of this order the runtime counts as held up right now, by how. */
function heldCounts(
  order: WorkOrder,
  sources: StandingSources
): Pick<StandingInput, 'asks' | 'stalls' | 'stranded'> {
  return {
    asks: sources.asksFor?.(order.id) ?? 0,
    stalls: sources.stallsFor?.(order.id) ?? 0,
    stranded: sources.strandedFor?.(order.id) ?? 0,
  }
}

// Only a draft can sit on a refused turn, be shaped or be blocked by a check, so no
// other status reads its ledger just to be told no.
async function draftFacts(
  order: WorkOrder,
  sources: StandingSources
): Promise<Pick<StandingInput, 'intakeRefused' | 'shaping' | 'blocker'>> {
  if (order.status !== 'draft') return { intakeRefused: null, shaping: false, blocker: null }
  return {
    intakeRefused: (await sources.intakeRefusedFor?.(order.id)) ?? null,
    shaping: (await sources.shapingFor?.(order.id)) ?? true,
    blocker: sources.blockerFor?.(order) ?? null,
  }
}

// Only an agreed or running order can have a failed or refused run, and only a
// running one a document, so no other status reads its ledger for nothing.
async function runFacts(
  order: WorkOrder,
  sources: StandingSources
): Promise<Pick<StandingInput, 'runFailure' | 'documentReady'>> {
  const runs = order.status === 'running' || order.status === 'agreed'
  return {
    runFailure: runs ? ((await sources.runFailureFor?.(order.id)) ?? null) : null,
    documentReady:
      order.status === 'running' ? ((await sources.documentReadyFor?.(order.id)) ?? null) : null,
  }
}
