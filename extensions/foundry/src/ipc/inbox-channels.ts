import { z } from 'zod'
import { decide, applyDefault, isOverdue, ruleInWords } from '../gates/rules.js'
import { raisedLimitProblem, withLimit } from '../line/scheduler.js'
import { rankInbox, summariseInbox } from '../gates/rank.js'
import { isLive, silencedRules } from '../gates/autonomy.js'
import type { Autonomy } from '../gates/autonomy.js'
import type { Gate } from '../gates/rules.js'
import type { GateStore } from '../gates/store.js'
import type { OrderStore } from '../order/store.js'
import type { WorkOrder } from '../order/schema.js'
import { pullNumber } from '../line/pull-number.js'
import { documentLinkOf } from '../line/document-outcome.js'
import type { DocumentLink } from '../line/document-kind.js'

// The one surface the operator is required to visit.
//
// Everything here is ranked by how much work the decision unblocks, and every
// row names the rule that raised it. Nothing reaches this list that a rule did
// not produce, which is what makes "nothing needs you" a state worth trusting.

export const DecidePayload = z.object({
  gateId: z.string(),
  option: z.string(),
  note: z.string().optional(),
  /** The new limit when raising a budget. Null is no limit. */
  limit: z.number().int().min(1).nullable().optional(),
})

export interface InboxDeps {
  readonly gates: GateStore
  readonly orders: OrderStore
  readonly autonomy: () => Autonomy
  readonly now: () => string
  /** Appends the decision to the order's own ledger. */
  readonly record: (orderId: string, line: InboxLine) => Promise<void>
  /**
   * Carry out what the decision means — mark a pull request ready, resume a
   * held run.
   *
   * A seam rather than a call so this file keeps knowing nothing about shells
   * or pull requests. Its failure is reported and never unmakes the decision:
   * the decision was the operator's and is already in the ledger; `gh` being
   * unreachable is a separate problem with a separate fix.
   */
  readonly act: (gate: Gate, option: string) => Promise<void>
  /**
   * The pull requests an order opened, so a gate can link them.
   */
  readonly readPulls: (orderId: string) => Promise<readonly { readonly url: string }[]>
  /** The order's own directory, which a document's relative path is read against. */
  readonly orderDirectory: (orderId: string) => string
  /**
   * Orders waiting on the operator that no gate stands for — a draft ready to
   * hand off, shaping that stopped, a run that did not start. Without them
   * this list said "Nothing needs you" over an order nothing would move.
   */
  readonly waiting: () => Promise<readonly WaitingRow[]>
}

/** One line of an order's ledger, as the operator's decision writes it. */
interface InboxLine {
  readonly action: string
  readonly subject: string
  readonly reason: string
}

interface WaitingRow {
  readonly orderId: string
  readonly title: string
  readonly headline: string
  readonly detail: string
}

export interface InboxChannels {
  list(): ReturnType<typeof list>
  decide(payload: z.infer<typeof DecidePayload>): ReturnType<typeof decideGate>
}

export function createInboxChannels(deps: InboxDeps): InboxChannels {
  return {
    list: () => list(deps),
    decide: (payload) => decideGate(deps, payload),
  }
}

type DecideInput = z.infer<typeof DecidePayload>

async function list(deps: InboxDeps) {
  const autonomy = deps.autonomy()
  const settled = await settleOverdue(deps, autonomy)
  const orders = await deps.orders.list()
  const rows = await orderRows(deps, orders, settled)
  return {
    gates: rankInbox(settled).map((gate) => ({ ...gate, ...rows(gate.orderId) })),
    // What this setting does not ask about: without it an operator cannot tell a
    // quiet factory from a deaf one.
    waiting: await deps.waiting(),
    autonomy,
    silenced: silencedRules(autonomy),
    summary: {
      ...summariseInbox(settled),
      building: orders.filter((o) => o.status === 'running').length,
      converging: orders.filter((o) => o.status === 'draft').length,
    },
  }
}

// The gates this setting shows: one whose rule it silences is hidden, and one past
// its deadline takes its stated default rather than waiting for ever.
async function settleOverdue(deps: InboxDeps, autonomy: Autonomy): Promise<Gate[]> {
  const now = deps.now()
  const live = (await deps.gates.list()).filter((gate) => isLive(gate.rule, autonomy))
  const settled = live.map((gate) => (isOverdue(gate, now) ? applyDefault(gate, now) : gate))
  for (const gate of settled) {
    const original = live.find((g) => g.id === gate.id)
    if (original?.decision === null && gate.decision !== null) {
      await takeDefault(deps, gate, gate.decision.option)
    }
  }
  return settled
}

async function takeDefault(deps: InboxDeps, gate: Gate, option: string): Promise<void> {
  await deps.gates.save(gate)
  await deps.record(gate.orderId, {
    action: 'gate.default',
    subject: gate.id,
    reason: `${ruleInWords(gate.rule)}: no answer by the deadline`,
  })
  // Acted on, not only recorded: a default that leaves the run halted is no default.
  // The operator's own seam, and a failure is written down, never thrown at a caller
  // that only asked what is waiting.
  await actOrRecord(deps, gate, option)
}

/** Act on a decision; a failure is recorded and said, never thrown. */
async function actOrRecord(deps: InboxDeps, gate: Gate, option: string): Promise<string | null> {
  try {
    await deps.act(gate, option)
    return null
  } catch (error) {
    const reason = (error as Error).message
    await deps.record(gate.orderId, { action: 'gate.action_failed', subject: gate.id, reason })
    return reason
  }
}

/** What each gate's row says about its order: title, pulls and ticket. */
async function orderRows(
  deps: InboxDeps,
  orders: readonly WorkOrder[],
  gates: readonly Gate[]
): Promise<(orderId: string) => OrderRow> {
  const titleFor = new Map(orders.map((order) => [order.id, order.title]))
  const ticketFor = new Map(orders.map((order) => [order.id, ticketOf(order)]))
  const documentFor = new Map(
    orders.map((order) => [order.id, documentLinkOf(order, deps.orderDirectory(order.id))])
  )
  // Once per order, not per gate: a queue of six gates on one order is one read.
  const pullsFor = new Map<string, { number: number; url: string }[]>()
  for (const orderId of new Set(gates.map((gate) => gate.orderId))) {
    const pulls = await deps.readPulls(orderId)
    pullsFor.set(
      orderId,
      pulls.map((pull) => ({ number: pullNumber(pull.url), url: pull.url }))
    )
  }
  return (orderId) => ({
    orderTitle: titleFor.get(orderId) ?? null,
    pulls: pullsFor.get(orderId) ?? [],
    source: ticketFor.get(orderId) ?? null,
    document: documentFor.get(orderId) ?? null,
  })
}

interface OrderRow {
  readonly orderTitle: string | null
  readonly pulls: { number: number; url: string }[]
  readonly source: { key: string; url: string } | null
  readonly document: DocumentLink | null
}

function ticketOf(order: WorkOrder): { key: string; url: string } | null {
  const { key, url } = order.source
  return key != null && url != null ? { key, url } : null
}

async function decideGate(deps: InboxDeps, payload: DecideInput) {
  const gate = await deps.gates.get(payload.gateId)
  if (gate === null) return { error: `No gate ${payload.gateId}.` }
  if (gate.decision !== null) {
    return { error: `Gate ${gate.id} was already decided (${gate.decision.option}).` }
  }
  const raise = await raiseFor(deps, gate, payload)
  if ('error' in raise) return raise

  let decided
  try {
    decided = decide(gate, { option: payload.option, note: payload.note ?? '', at: deps.now() })
  } catch (error) {
    return { error: (error as Error).message }
  }

  // Recorded before it is acted on: a decision that changed the world but
  // left no trace is the one nobody can explain afterwards.
  await deps.record(gate.orderId, decidedLine(gate, payload))
  await deps.gates.save(decided)
  if (raise.raise !== null) await raiseBudget(deps, raise.raise)

  const actionError = await actOrRecord(deps, decided, payload.option)
  return actionError === null
    ? { ok: true, gate: decided }
    : { ok: true, gate: decided, actionError }
}

/** A budget raise a decision carries: the breach, its order and the new limit. */
interface Raise {
  readonly breach: NonNullable<Gate['breach']>
  readonly order: WorkOrder
  readonly limit: number | null
}

// The raise a decision asks for, none, or why it cannot be taken. A gate without a
// breach predates recording it; resuming raises a fresh one that has it.
async function raiseFor(
  deps: InboxDeps,
  gate: Gate,
  { option, limit }: DecideInput
): Promise<{ raise: Raise | null } | { error: string }> {
  const breach = option === 'raise' ? (gate.breach ?? null) : null
  if (breach === null) return { raise: null }
  const order = await deps.orders.load(gate.orderId)
  if (limit === undefined) return { error: 'Say what the new limit is, or choose no limit.' }
  const problem = raisedLimitProblem(breach, limit)
  if (problem !== null) return { error: problem }
  if (order === null) return { error: `No order ${gate.orderId}.` }
  return { raise: { breach, order, limit } }
}

function decidedLine(gate: Gate, { option, note }: DecideInput): InboxLine {
  return {
    action: 'gate.decided',
    subject: gate.id,
    reason: `${ruleInWords(gate.rule)} -> ${option}${note === undefined ? '' : `: ${note}`}`,
  }
}

async function raiseBudget(deps: InboxDeps, { breach, order, limit }: Raise): Promise<void> {
  await deps.orders.save({ ...order, budgets: withLimit(order.budgets, breach.kind, limit) })
  await deps.record(order.id, {
    action: 'budget.raised',
    subject: breach.kind,
    reason: `${breach.limit} -> ${limit === null ? 'no limit' : limit}`,
  })
}
