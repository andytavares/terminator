import { z } from 'zod'
import { seedOrder, newOrderId } from '../forge/intake-source.js'
import type { IssueLike } from '../forge/intake-source.js'
import { answerQuestion } from '../forge/interview.js'
import { strikeAssumption } from '../forge/assumptions.js'
import { applyFindings } from '../forge/red-team.js'
import { compileOrder, agreeOrder } from '../order/compile.js'
import type { OrderStore } from '../order/store.js'
import type { WorkOrder } from '../order/schema.js'

// The Forge's three channels.
//
// Kept out of the extension entry point so they can be exercised without an
// Electron host: the entry point supplies a store, a clock and a way to read an
// issue, and everything below is ordinary async functions over those.

const CreatePayload = z.object({
  source: z.object({
    kind: z.enum(['typed', 'tracker', 'failing_run', 'review_comment', 'deferred']),
    text: z.string().optional(),
    tracker: z.enum(['linear', 'jira']).optional(),
    key: z.string().optional(),
  }),
  repoPaths: z.array(z.string()),
})

const TurnPayload = z.object({
  id: z.string(),
  message: z.string().optional(),
  strike: z.string().optional(),
  answer: z
    .object({ questionId: z.string(), option: z.union([z.string(), z.number()]) })
    .optional(),
})

const CompilePayload = z.object({ id: z.string(), commit: z.boolean().default(false) })

export interface ForgeDeps {
  readonly store: OrderStore
  readonly now: () => string
  readonly readIssue?: (tracker: 'linear' | 'jira', key: string) => Promise<IssueLike | null>
}

export interface ForgeChannels {
  create(payload: unknown): Promise<unknown>
  turn(payload: unknown): Promise<unknown>
  compile(payload: unknown): Promise<unknown>
  list(): Promise<unknown>
}

/** The order plus its checks — what every Forge channel hands back. */
function view(order: WorkOrder, changed: string[] = []) {
  return { order, compile: compileOrder(order), changed }
}

export function createForgeChannels(deps: ForgeDeps): ForgeChannels {
  async function create(raw: unknown): Promise<unknown> {
    const parsed = CreatePayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }
    const { source, repoPaths } = parsed.data

    const input =
      source.kind === 'tracker'
        ? {
            kind: 'tracker' as const,
            tracker: source.tracker ?? 'linear',
            key: source.key ?? '',
            repoPaths,
          }
        : { kind: 'typed' as const, text: source.text ?? '', repoPaths }

    const seeded = await seedOrder(input, {
      now: deps.now,
      newId: () => newOrderId(new Date(deps.now())),
      readIssue: deps.readIssue,
      existingOrderFor: () => null,
    })

    if ('error' in seeded) return seeded
    if ('existing' in seeded) return seeded

    // The duplicate check reads the store, so it happens here rather than
    // inside seeding — seeding stays a pure function of its inputs.
    if (seeded.order.source.tracker !== null && seeded.order.source.key !== null) {
      const existing = await deps.store.findByIssue(
        seeded.order.source.tracker,
        seeded.order.source.key
      )
      if (existing !== null) return { existing }
    }

    // The adversarial pass runs on the first draft, not only at the end: a
    // finding the operator sees now is cheaper than one that reopens an order
    // they thought was settled.
    const attacked = applyFindings(seeded.order, deps.now())
    await deps.store.save(attacked)
    await deps.store.record({
      at: deps.now(),
      orderId: attacked.id,
      actor: 'role:scout',
      action: 'order.seeded',
      subject: attacked.id,
      reason: `seeded from ${attacked.source.kind}`,
      evidence: [],
    })

    return { ...view(attacked), unavailableChecks: seeded.unavailableChecks }
  }

  async function turn(raw: unknown): Promise<unknown> {
    const parsed = TurnPayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }
    const { id, strike, answer } = parsed.data

    const order = await deps.store.load(id)
    if (order === null) return { error: `No order ${id}.` }

    if (strike !== undefined) {
      const result = strikeAssumption(order, strike)
      await deps.store.save(result.order)
      await deps.store.record({
        at: deps.now(),
        orderId: id,
        actor: 'operator',
        action: 'assumption.struck',
        subject: strike,
        reason: `redraw ${result.redraw.join(', ') || 'nothing'}`,
        evidence: [],
      })
      return view(result.order, [...result.redraw])
    }

    if (answer !== undefined) {
      const next: WorkOrder = {
        ...order,
        openQuestions: answerQuestion(order.openQuestions, answer.questionId, answer.option),
      }
      await deps.store.save(next)
      await deps.store.record({
        at: deps.now(),
        orderId: id,
        actor: 'operator',
        action: 'question.answered',
        subject: answer.questionId,
        reason: String(answer.option),
        evidence: [],
      })
      return view(next, [answer.questionId])
    }

    // Free text has no effect on the document by itself — it goes to the agent
    // session, and the redraft arrives as a later save. Returning the order
    // unchanged is honest about that rather than pretending something moved.
    return view(order)
  }

  async function compile(raw: unknown): Promise<unknown> {
    const parsed = CompilePayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }
    const { id, commit } = parsed.data

    const order = await deps.store.load(id)
    if (order === null) return { error: `No order ${id}.` }

    const result = compileOrder(order)
    if (!commit || !result.ok) return { compile: result, order }

    const agreed = agreeOrder(order, deps.now())
    if (!agreed.ok) return { compile: agreed.result, order }

    await deps.store.save(agreed.order)
    await deps.store.record({
      at: deps.now(),
      orderId: id,
      actor: 'operator',
      action: 'order.agreed',
      subject: id,
      reason: 'all six checks pass',
      evidence: [],
    })
    return { compile: compileOrder(agreed.order), order: agreed.order }
  }

  /** Every order, newest first, each with where its checks stand. */
  async function list(): Promise<unknown> {
    const orders = await deps.store.list()
    return {
      orders: orders.map((order) => ({
        id: order.id,
        title: order.title,
        status: order.status,
        risk: order.risk.grade,
        source: order.source,
        failures: compileOrder(order).failures.length,
      })),
    }
  }

  return { create, turn, compile, list }
}
