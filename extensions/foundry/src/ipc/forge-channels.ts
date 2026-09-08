import { z } from 'zod'
import { seedOrder, newOrderId } from '../forge/intake-source.js'
import type { IssueLike } from '../forge/intake-source.js'
import { answerQuestion, surfacedQuestions } from '../forge/interview.js'
import { strikeAssumption } from '../forge/assumptions.js'
import { applyFindings, resolveFinding, acceptFinding } from '../forge/red-team.js'
import { compileOrder, agreeOrder } from '../order/compile.js'
import type { OrderStore } from '../order/store.js'
import { TransitionIntentSchema, WriteBackSchema } from '../order/schema.js'
import type { TransitionIntent, WorkOrder, WriteBack } from '../order/schema.js'
import type { CapabilityReport } from '../trackers/write-back.js'

/** What one turn of intake produced, or why it produced nothing. */
export type ConvergeOutcome =
  | { ok: true; order: WorkOrder; note: string }
  | { ok: false; reason: string }

/** Whether the architect is now running, or why it is not. */
export type ConvergeStarted = { ok: true; sessionId: string } | { ok: false; reason: string }

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

const CancelPayload = z.object({
  id: z.string(),
  reason: z.string().optional(),
})

const TurnPayload = z.object({
  id: z.string(),
  message: z.string().optional(),
  strike: z.string().optional(),
  answer: z
    .object({ questionId: z.string(), option: z.union([z.string(), z.number()]) })
    .optional(),
  /**
   * Clear an adversarial finding.
   *
   * `resolved` means it was fixed; `accepted` means it stands and the operator
   * has said why. Without one of these the compile gate refuses the order for
   * ever, which is what it did before this existed.
   */
  finding: z
    .object({
      id: z.string(),
      decision: z.enum(['resolved', 'accepted']),
      reason: z.string().default(''),
    })
    .optional(),
  /**
   * Accept a criterion as unverifiable.
   *
   * The one escape from "every criterion must be provable", and the compile
   * check has named it in its own failure text since the beginning — while
   * nothing in the application could reach it. Only the architect's proposal
   * could set the field, so an operator whose plan changes something a person
   * sees, and whose architect would not write a screenshot criterion, was held
   * at a red check with no move to make.
   */
  unverifiable: z.object({ criterionId: z.string(), reason: z.string().default('') }).optional(),
})

const CompilePayload = z.object({ id: z.string(), commit: z.boolean().default(false) })

const WriteBackPayload = z.object({
  id: z.string(),
  writeBack: z.array(WriteBackSchema),
})

const MapStatePayload = z.object({
  id: z.string(),
  intent: TransitionIntentSchema,
  // Null puts the intent back to whatever the tracker resolves it to.
  optionId: z.string().nullable(),
})

const StatesPayload = z.object({ id: z.string() })

export interface ForgeDeps {
  readonly store: OrderStore
  readonly now: () => string
  readonly readIssue?: (tracker: 'linear' | 'jira', key: string) => Promise<IssueLike | null>
  /**
   * Which write-backs a new order starts with (FR-062), from configuration.
   *
   * A function, like the other two below: these channels are built once when
   * the extension activates, and a value read then is the value the operator
   * had at start-up rather than the one they have now.
   */
  readonly writeBackDefault?: () => readonly WriteBack[]
  /**
   * The budgets a new order starts with (FR-030), from configuration.
   *
   * A default, not a ceiling: the architect may propose different ones and the
   * operator may change them. Absent, the schema's own defaults stand — which
   * is what happened for every order before this was wired, and is why an
   * operator who set the agent limit to 1 still got three.
   */
  readonly budgetDefaults?: () => { agents: number; wallClockMinutes: number; filesTouched: number }
  /**
   * The paths the operator declared critical (FR-043). Workspace-scoped and
   * operator-declared: Foundry never infers this list, and an order that
   * cannot see it grades a change to a critical path as if it were ordinary.
   */
  readonly criticalPaths?: () => readonly string[]
  /** Past decisions about the files a new idea names (FR-077). */
  readonly priorArtFor?: (paths: readonly string[]) => Promise<string[]>
  /**
   * Start one turn of intake, and resolve as soon as it is *running*.
   *
   * Not when it finishes. An architect takes minutes, and a channel that
   * waited would hold the bridge for all of them — the surface would spin with
   * no way to see what the agent was doing, which is the opposite of running
   * it in a terminal you can watch.
   *
   * The redraft lands later, through the store, and the surface sees it on its
   * next read. A seam, so this file starts no sessions and knows nothing about
   * terminals; absent means intake cannot run, which is said out loud rather
   * than leaving a draft that can never be agreed.
   */
  readonly converge?: (order: WorkOrder, message: string) => Promise<ConvergeStarted>
  /**
   * What the source tracker can be asked to do, and the states it offers.
   *
   * Consulted when the order is agreed rather than when a write is due
   * (FR-059a): an order whose issue will never move is something the operator
   * should know before the run, not find in the ledger afterwards.
   */
  readonly capability?: (order: WorkOrder) => Promise<CapabilityReport>
  /** The agreement write-back. Its failure never fails the agreement. */
  readonly onAgreed?: (order: WorkOrder) => Promise<void>
}

export interface ForgeChannels {
  /** Run one turn of intake: the architect drafts, or redrafts, the plan. */
  converge(payload: unknown): Promise<unknown>
  create(payload: unknown): Promise<unknown>
  turn(payload: unknown): Promise<unknown>
  compile(payload: unknown): Promise<unknown>
  list(): Promise<unknown>
  /** The candidate states, for the operator to map intents against. */
  states(payload: unknown): Promise<unknown>
  /** Record which state one intent means for this order. */
  mapState(payload: unknown): Promise<unknown>
  /** Turn each write-back on or off for this order (FR-062). */
  setWriteBack(payload: unknown): Promise<unknown>
  /** Discard an order that should not have been made. */
  cancel(payload: unknown): Promise<unknown>
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
      priorArtFor: deps.priorArtFor,
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
    const configured: WorkOrder = {
      ...seeded.order,
      writeBack: [...(deps.writeBackDefault?.() ?? [])],
      budgets: {
        ...seeded.order.budgets,
        ...(deps.budgetDefaults?.() ?? {}),
      },
      risk: {
        ...seeded.order.risk,
        criticalPaths: [...(deps.criticalPaths?.() ?? [])],
      },
    }

    const attacked = applyFindings(configured, deps.now())
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

    if (parsed.data.finding !== undefined) {
      const { id: findingId, decision, reason } = parsed.data.finding
      if (decision === 'accepted' && reason.trim() === '') {
        // An accepted finding with no reason is a shrug, and the compile check
        // would refuse it anyway — said here rather than silently ignored.
        return { ...view(order), error: 'Accepting a finding costs a written reason.' }
      }
      const next =
        decision === 'resolved'
          ? resolveFinding(order, findingId)
          : acceptFinding(order, findingId, reason)

      await deps.store.save(next)
      await deps.store.record({
        at: deps.now(),
        orderId: id,
        actor: 'operator',
        action: `finding.${decision}`,
        subject: findingId,
        reason: reason.trim() === '' ? 'fixed' : reason.trim(),
        evidence: [],
      })
      return view(next, ['redTeam'])
    }

    if (parsed.data.unverifiable !== undefined) {
      const { criterionId, reason } = parsed.data.unverifiable
      if (reason.trim() === '') {
        // The schema refuses an empty reason too, but it would refuse it as a
        // malformed order rather than as the thing it is: an accepted
        // unverifiable with no reason is a shrug, and the operator is told so.
        return { ...view(order), error: 'Accepting a criterion as unverifiable costs a reason.' }
      }
      if (!order.acceptance.some((criterion) => criterion.id === criterionId)) {
        return { ...view(order), error: `No criterion ${criterionId} in this order.` }
      }
      const next: WorkOrder = {
        ...order,
        acceptance: order.acceptance.map((criterion) =>
          criterion.id === criterionId
            ? { ...criterion, unverifiable: { accepted: true as const, reason: reason.trim() } }
            : criterion
        ),
      }
      await deps.store.save(next)
      await deps.store.record({
        at: deps.now(),
        orderId: id,
        actor: 'operator',
        action: 'criterion.unverifiable',
        subject: criterionId,
        reason: reason.trim(),
        evidence: [],
      })
      return view(next, ['acceptance'])
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

    // Free text goes to the architect, which is the whole conversational half
    // of the Forge. It used to return the order unchanged with a comment
    // saying the text had gone to an agent session; there was no agent.
    if (parsed.data.message !== undefined && parsed.data.message.trim() !== '') {
      return converge({ id, message: parsed.data.message })
    }

    return view(order)
  }

  /**
   * One turn of intake.
   *
   * The architect reads the draft and the repository and proposes criteria, a
   * plan, a risk grade and budgets. It runs read-only and writes one file,
   * which is validated before any of it reaches the order — an agent that
   * could write the order directly could set its status and agree its own work.
   */
  async function converge(raw: unknown): Promise<unknown> {
    const parsed = TurnPayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }

    const id = parsed.data.id
    const order = await deps.store.load(id)
    if (order === null) return { error: `No order ${id}.` }
    if (order.status !== 'draft') {
      return { error: `Only a draft can be converged; this order is ${order.status}.` }
    }
    if (deps.converge === undefined) {
      return {
        ...view(order),
        error:
          'Intake cannot run: there is no supervision runtime, so no architect can draft the plan.',
      }
    }

    const started = await deps.converge(order, parsed.data.message ?? '')
    if (!started.ok) {
      await deps.store.record({
        at: deps.now(),
        orderId: id,
        actor: 'role:architect',
        action: 'converge.refused',
        subject: id,
        reason: started.reason,
        evidence: [],
      })
      return { ...view(order), error: started.reason }
    }

    await deps.store.record({
      at: deps.now(),
      orderId: id,
      actor: 'role:architect',
      action: 'converge.started',
      subject: started.sessionId,
      reason: parsed.data.message === undefined ? 'drafting the plan' : parsed.data.message,
      evidence: [],
    })
    // The order as it stands, plus the session the architect is working in —
    // so the surface can say it is running and take the operator to it.
    return { ...view(order), converging: started.sessionId }
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

    // Both of these are about the tracker, and neither may unmake an
    // agreement that has already been recorded (FR-063).
    let capability: CapabilityReport | undefined
    try {
      capability = await deps.capability?.(agreed.order)
    } catch {
      capability = undefined
    }
    try {
      await deps.onAgreed?.(agreed.order)
    } catch {
      // Recorded by the write-back itself; the order is agreed regardless.
    }

    return { compile: compileOrder(agreed.order), order: agreed.order, capability }
  }

  /**
   * What the tracker offers, for the mapping panel.
   *
   * Its own channel rather than part of `compile` because compile is polled
   * and this is a network read: asking the tracker every time the document
   * redraws would spend the operator's rate limit on nothing.
   */
  async function states(raw: unknown): Promise<unknown> {
    const parsed = StatesPayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }
    const order = await deps.store.load(parsed.data.id)
    if (order === null) return { error: `No order ${parsed.data.id}.` }
    if (deps.capability === undefined) {
      return { capability: { transitions: 'no_issue', states: [], unreachable: [] } }
    }
    try {
      return { capability: await deps.capability(order), mapping: order.stateMapping }
    } catch (error) {
      return { error: (error as Error).message }
    }
  }

  async function mapState(raw: unknown): Promise<unknown> {
    const parsed = MapStatePayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }
    const { id, intent, optionId } = parsed.data

    const order = await deps.store.load(id)
    if (order === null) return { error: `No order ${id}.` }

    const next: WorkOrder = {
      ...order,
      stateMapping: { ...order.stateMapping, [intent as TransitionIntent]: optionId },
    }
    await deps.store.save(next)
    await deps.store.record({
      at: deps.now(),
      orderId: id,
      actor: 'operator',
      action: 'writeback.mapped',
      subject: intent,
      reason: optionId === null ? 'back to whatever the tracker resolves' : optionId,
      evidence: [],
    })
    return { ok: true, mapping: next.stateMapping }
  }

  /** Every order, newest first, each with where its checks stand. */
  /**
   * Discard an order.
   *
   * `cancelled` has been in the schema since the beginning and nothing ever
   * set it: an order made by mistake stayed on the list for good, and there
   * was no way to start again. Marked rather than deleted — the records are
   * the point of this thing, and a discarded order is part of what happened.
   *
   * A running one is refused. Its agents are in their terminals with work in
   * their worktrees, and throwing that away silently is the opposite of what
   * every budget and gate here is for; stop it at its gate first.
   */
  async function cancel(raw: unknown): Promise<unknown> {
    const parsed = CancelPayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }

    const order = await deps.store.load(parsed.data.id)
    if (order === null) return { error: `No order ${parsed.data.id}.` }
    if (order.status === 'running') {
      return {
        error: `${order.id} is running. Stop it at its gate before discarding it — its agents still have work in their worktrees.`,
      }
    }
    if (order.status === 'cancelled') return view(order)

    const next: WorkOrder = { ...order, status: 'cancelled' as const }
    await deps.store.save(next)
    await deps.store.record({
      at: deps.now(),
      orderId: order.id,
      actor: 'operator',
      action: 'order.cancelled',
      subject: order.id,
      reason: parsed.data.reason ?? 'Discarded by the operator.',
      evidence: [],
    })
    return view(next)
  }

  async function list(): Promise<unknown> {
    const orders = await deps.store.list()
    return {
      // A discarded order stays in the records and leaves the list; the list is
      // what needs doing, not what was ever asked for.
      orders: orders
        .filter((order) => order.status !== 'cancelled')
        .map((order) => ({
          id: order.id,
          title: order.title,
          status: order.status,
          risk: order.risk.grade,
          source: order.source,
          failures: compileOrder(order).failures.length,
          // Which order the tab's badge is counting. A number on the chrome
          // that sends you to a list saying nothing about where it came from
          // is a number you have to open every row to act on.
          openQuestions:
            order.status === 'draft' ? surfacedQuestions(order.openQuestions).length : 0,
        })),
    }
  }

  /**
   * Which write-backs this order does.
   *
   * Per order, defaulting from configuration (FR-062): a run against somebody
   * else's repository, or one seeded from an issue nobody else watches, is a
   * reason to turn one off without changing the setting for every order after
   * it.
   */
  async function setWriteBack(raw: unknown): Promise<unknown> {
    const parsed = WriteBackPayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }

    const order = await deps.store.load(parsed.data.id)
    if (order === null) return { error: `No order ${parsed.data.id}.` }

    const next: WorkOrder = { ...order, writeBack: parsed.data.writeBack }
    await deps.store.save(next)
    await deps.store.record({
      at: deps.now(),
      orderId: parsed.data.id,
      actor: 'operator',
      action: 'writeback.configured',
      subject: parsed.data.id,
      reason:
        parsed.data.writeBack.length === 0
          ? 'nothing is written back to the tracker'
          : parsed.data.writeBack.join(', '),
      evidence: [],
    })
    return view(next, ['writeBack'])
  }

  return { create, turn, compile, list, states, mapState, converge, setWriteBack, cancel }
}
