import { z } from 'zod'
import { seedOrder, newOrderId } from '../forge/intake-source.js'
import type { IssueLike } from '../forge/intake-source.js'
import { answerQuestion, surfacedQuestions } from '../forge/interview.js'
import { strikeAssumption } from '../forge/assumptions.js'
import { applyFindings, acceptFinding } from '../forge/red-team.js'
import { compileOrder, agreeOrder } from '../order/compile.js'
import type { OrderStore } from '../order/store.js'
import { readStanding } from '../order/standing.js'
import { orderStandingSources } from '../order/order-standing-sources.js'
import {
  lastIntake,
  loopFacts,
  agreedFacts,
  turnEndedAt as turnEndedAtOf,
} from '../forge/intake-outcome.js'
import type { IntakeOutcome } from '../forge/intake-outcome.js'
import type { LoopFacts, AgreedFacts } from '../forge/readiness.js'
import { readCiState } from '../line/ci-state.js'
import { readPulls } from '../line/integrate.js'
import { pullNumber } from '../line/pull-number.js'
import { queue, advisory as advisoryFor } from '../line/refinery.js'
import type { QueueEntry } from '../line/refinery.js'
import type { StandingSources } from '../order/standing.js'
import { TransitionIntentSchema, WorkOrderSchema, WriteBackSchema } from '../order/schema.js'
import type { Budgets, TransitionIntent, WorkOrder, WriteBack } from '../order/schema.js'
import { budgetsInWords } from '../order/render.js'
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

/**
 * Everything the operator decided in the "Needs you" band, in one submit.
 *
 * Seven findings used to cost seven serial turns, one clicked at a time,
 * because a turn had to land and the order had to be re-agreed before the
 * next one could be raised. An answer or an accept changes the order directly
 * and needs no turn; a fix or an ask is the architect's, and every one of
 * those goes in the single turn `converge` starts once, naming every finding
 * it carries.
 */
const SettlePayload = z.object({
  answers: z
    .array(z.object({ questionId: z.string(), option: z.union([z.string(), z.number()]) }))
    .optional(),
  accepts: z.array(z.object({ findingId: z.string(), reason: z.string() })).optional(),
  fixes: z.array(z.object({ findingId: z.string(), how: z.string() })).optional(),
  asks: z.array(z.string()).optional(),
})

type SettleInput = z.infer<typeof SettlePayload>

const TurnPayload = z.object({
  id: z.string(),
  message: z.string().optional(),
  strike: z.string().optional(),
  answer: z
    .object({ questionId: z.string(), option: z.union([z.string(), z.number()]) })
    .optional(),
  /**
   * Accept an adversarial finding: it stands, and the operator has said why.
   *
   * Fixing one is not a decision here. It is the architect's, through a
   * converge turn that changes the order and reports it in `resolveFindings`;
   * a bare "fixed" cleared the gate while the order stayed as it was.
   */
  finding: z
    .object({
      id: z.string(),
      decision: z.literal('accepted'),
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
  /**
   * Settle everything the operator decided in the band, in one converge call
   * — see `SettlePayload`. Only `converge` reads this field.
   */
  settle: SettlePayload.optional(),
})

const CompilePayload = z.object({
  id: z.string(),
  commit: z.boolean().default(false),
  /** Foundry agreeing an order the operator already released, after an amendment. */
  automatic: z.boolean().default(false),
})

const RecipePayload = z.object({ id: z.string(), recipe: z.string().nullable() })
const HoldPayload = z.object({ id: z.string(), held: z.boolean() })

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

const BudgetsPayload = z.object({
  id: z.string(),
  budgets: WorkOrderSchema.shape.budgets.pick({ agents: true, wallClockMinutes: true }).strict(),
})

export interface ForgeDeps {
  readonly store: OrderStore
  readonly now: () => string
  /**
   * Where each row's standing comes from.
   *
   * The list is a door onto work in flight, so it has to say what that work is
   * doing — and the graph, the gates and whether an agent is alive are none of
   * them in the order record. Absent, a row still stands somewhere: a draft is
   * being shaped and everything else is starting, which is what a host with no
   * run runtime is actually true of.
   */
  readonly standingSources?: StandingSources
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
   * A default, not a ceiling: the operator may change them per order, and the
   * architect may not. Absent, the schema's own defaults stand — which is what
   * happened for every order before this was wired, and is why an operator who
   * set the agent limit to 1 still got three.
   */
  readonly budgetDefaults?: () => Omit<Budgets, 'tokens'>
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
  /**
   * Where the records live, so the list can read each order's `ci.json`.
   *
   * Resolved on every call, like the other read-only deps here: the records
   * location follows the open workspace. Absent means the row carries no `ci`
   * field at all, which is what a host that has never wired CI is actually
   * true of.
   */
  readonly dataRoot?: () => string
  /**
   * Every in-flight order's queue entries, for the refinery's file-overlap
   * queue: the list's `queue` field, and the advisory shown on agreement.
   * Absent means no queue to ask, which reads as "not queued" — a host that
   * has never wired the refinery has nothing to say either way.
   */
  readonly queueEntries?: () => Promise<readonly QueueEntry[]>
  /**
   * The side effect of releasing a hold: pick the loop back up.
   *
   * Kept out of this file on purpose — `hold` only records the ledger line
   * and hands back the view, the same as every other channel here. What
   * "release" actually resumes (start the next review round, send a
   * follow-up, hand off) is the loop's own business, in `src/index.ts`.
   */
  readonly onReleased?: (order: WorkOrder) => void
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
  /** Set a draft order's budgets. Null is no limit. */
  setBudgets(payload: unknown): Promise<unknown>
  /** Discard an order that should not have been made. */
  cancel(payload: unknown): Promise<unknown>
  /** Choose which shape hand-off will run (FR-014's override). */
  recipe(payload: unknown): Promise<unknown>
  /** Hold the loop for the operator, or release it. */
  hold(payload: unknown): Promise<unknown>
}

/** The order plus its checks — what every Forge channel hands back. */
function view(order: WorkOrder, changed: string[] = []) {
  return { order, compile: compileOrder(order), changed }
}

/**
 * The backend facts the redesigned Forge reads, from one read of the ledger.
 *
 * Every response that used to carry `intake` alone now carries these four
 * together — one function so no call site can add a fifth response that
 * forgets one of them, the way `intake` alone was added in three places and
 * a fourth was missed.
 */
async function readFacts(
  store: OrderStore,
  orderId: string
): Promise<{
  intake: IntakeOutcome
  loop: LoopFacts
  agreed: AgreedFacts | null
  turnEndedAt: string | null
}> {
  const entries = await store.entries(orderId)
  return {
    intake: lastIntake(entries),
    loop: loopFacts(entries),
    agreed: agreedFacts(entries),
    turnEndedAt: turnEndedAtOf(entries),
  }
}

/**
 * What agreeing this order is about to queue behind, if anything.
 *
 * One repository at a time, because `advisory` compares a single repo+base
 * against the current queue — an order spanning several repositories can
 * queue behind different predecessors in each, and the operator reads one
 * sentence per repository rather than a single one that elides which.
 */
function advisoryForOrder(order: WorkOrder, entries: readonly QueueEntry[]): string | null {
  const messages = order.context.repos
    .map((repo) => {
      const files = order.plan.units
        .filter((unit) => unit.lane === repo.lane)
        .flatMap((unit) => unit.touches)
      return advisoryFor({ repo: repo.name, base: repo.baseBranch, files }, entries)
    })
    .filter((message): message is string => message !== null)
  return messages.length === 0 ? null : messages.join(' ')
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
      if (reason.trim() === '') {
        // An accepted finding with no reason is a shrug, and the compile check
        // would refuse it anyway — said here rather than silently ignored.
        return { ...view(order), error: 'Accepting a finding costs a written reason.' }
      }
      const next = acceptFinding(order, findingId, reason)

      await deps.store.save(next)
      await deps.store.record({
        at: deps.now(),
        orderId: id,
        actor: 'operator',
        action: `finding.${decision}`,
        subject: findingId,
        reason: reason.trim(),
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
   * Start one architect turn, on the order and with the message given.
   *
   * The half of `converge` that actually talks to the architect — shared by a
   * plain turn and by a settle that ends in a fix or an ask, so there is one
   * place that starts a session and one place that records it.
   */
  async function runArchitectTurn(order: WorkOrder, message?: string): Promise<unknown> {
    if (deps.converge === undefined) {
      return {
        ...view(order),
        error:
          'Intake cannot run: there is no supervision runtime, so no architect can draft the plan.',
      }
    }

    const started = await deps.converge(order, message ?? '')
    if (!started.ok) {
      await deps.store.record({
        at: deps.now(),
        orderId: order.id,
        actor: 'role:architect',
        action: 'converge.refused',
        subject: order.id,
        reason: started.reason,
        evidence: [],
      })
      return {
        ...view(order),
        error: started.reason,
        ...(await readFacts(deps.store, order.id)),
      }
    }

    await deps.store.record({
      at: deps.now(),
      orderId: order.id,
      actor: 'role:architect',
      action: 'converge.started',
      subject: started.sessionId,
      reason: message === undefined ? 'drafting the plan' : message,
      evidence: [],
    })
    // The order as it stands, plus the session the architect is working in —
    // so the surface can say it is running and take the operator to it.
    //
    // `intake` comes back on this call too, and not only on the poll: the
    // Forge reads whether a turn is running from it, and a first answer that
    // omitted it would leave the surface idle until the next poll it was
    // never going to start.
    return {
      ...view(order),
      converging: started.sessionId,
      ...(await readFacts(deps.store, order.id)),
    }
  }

  /**
   * Settle everything the operator decided in the band, in one submit.
   *
   * An answer and an accept change the order directly and need no turn — they
   * are recorded exactly as `turn` records them, one ledger line each. A fix
   * or an ask is the architect's, and every one of those is folded into the
   * single turn this starts once, naming every finding it carries, rather
   * than the one-at-a-time loop that cost seven findings seven serial turns.
   *
   * A blank accept reason refuses the whole settle rather than applying the
   * rest and dropping the one that was a shrug: a partially-applied batch is
   * a batch the operator did not actually send.
   */
  async function settleTurn(
    order: WorkOrder,
    settle: SettleInput,
    message: string | undefined
  ): Promise<unknown> {
    const accepts = settle.accepts ?? []
    if (accepts.some((a) => a.reason.trim() === '')) {
      return { ...view(order), error: 'Accepting a finding costs a written reason.' }
    }

    let next = order
    const answers = settle.answers ?? []
    for (const answer of answers) {
      next = {
        ...next,
        openQuestions: answerQuestion(next.openQuestions, answer.questionId, answer.option),
      }
    }
    for (const accept of accepts) {
      next = acceptFinding(next, accept.findingId, accept.reason)
    }

    if (next !== order) {
      await deps.store.save(next)
      for (const answer of answers) {
        await deps.store.record({
          at: deps.now(),
          orderId: order.id,
          actor: 'operator',
          action: 'question.answered',
          subject: answer.questionId,
          reason: String(answer.option),
          evidence: [],
        })
      }
      for (const accept of accepts) {
        await deps.store.record({
          at: deps.now(),
          orderId: order.id,
          actor: 'operator',
          action: 'finding.accepted',
          subject: accept.findingId,
          reason: accept.reason.trim(),
          evidence: [],
        })
      }
    }

    const fixes = settle.fixes ?? []
    const asks = settle.asks ?? []
    if (fixes.length === 0 && asks.length === 0) {
      const changed = [
        ...answers.map((a) => a.questionId),
        ...(accepts.length > 0 ? ['redTeam'] : []),
      ]
      return view(next, changed)
    }

    const findingText = (id: string): string => next.redTeam.find((f) => f.id === id)?.text ?? ''
    const parts = [
      ...asks.map(
        (id) => `${id} is open: ${findingText(id)}. Change the order so it no longer holds.`
      ),
      ...fixes.map(
        (fix) =>
          `${fix.findingId} is open: ${findingText(fix.findingId)}. The operator says to fix it this way: ${fix.how}.`
      ),
      'Change what these name, and list each in `resolveFindings` with what you changed.',
    ]
    const composed =
      message === undefined || message.trim() === ''
        ? parts.join(' ')
        : `${parts.join(' ')} ${message}`

    return runArchitectTurn(next, composed)
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

    if (parsed.data.settle !== undefined) {
      return settleTurn(order, parsed.data.settle, parsed.data.message)
    }

    return runArchitectTurn(order, parsed.data.message)
  }

  async function compile(raw: unknown): Promise<unknown> {
    const parsed = CompilePayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }
    const { id, commit, automatic } = parsed.data

    const order = await deps.store.load(id)
    if (order === null) return { error: `No order ${id}.` }

    const result = compileOrder(order)
    // How the last intake turn ended, on the read the Forge polls.
    //
    // A refusal is recorded in the ledger and nowhere else, so a surface that
    // only reads the document cannot tell "the architect is working" from "the
    // architect finished an hour ago and nothing was accepted". The Forge
    // could not, and spun on the first while it was the second.
    const facts = await readFacts(deps.store, id)
    if (!commit || !result.ok) return { compile: result, order, ...facts }

    const agreed = agreeOrder(order, deps.now())
    if (!agreed.ok) return { compile: agreed.result, order, ...facts }

    await deps.store.save(agreed.order)
    await deps.store.record({
      at: deps.now(),
      orderId: id,
      actor: automatic ? 'rule:forge' : 'operator',
      action: 'order.agreed',
      subject: id,
      reason: automatic
        ? 'you released this order before, and the amended plan passes every check'
        : 'all checks pass',
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

    // What this order is about to queue behind, if anything — said once, at
    // the moment it becomes real work, rather than left for the operator to
    // discover as a merge conflict later.
    const advisory =
      deps.queueEntries === undefined
        ? null
        : advisoryForOrder(agreed.order, await deps.queueEntries())

    return {
      compile: compileOrder(agreed.order),
      order: agreed.order,
      // Recomputed rather than reused: the ledger line just written is the
      // agreement this response is about, and the read above predates it.
      ...(await readFacts(deps.store, id)),
      capability,
      advisory,
    }
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
    // A discarded order stays in the records and leaves the list; the list is
    // what needs doing, not what was ever asked for.
    const live = orders.filter((order) => order.status !== 'cancelled')
    // Computed once for the whole list rather than per row: every row's
    // queue position comes from the same set of in-flight orders.
    const queuePositions = deps.queueEntries === undefined ? null : queue(await deps.queueEntries())
    return {
      orders: await Promise.all(
        live.map(async (order) => {
          // Read once: the standing needs the order's gates to say whose move
          // it is, and the row needs the open one to put its answers on the line.
          const gates = (await deps.standingSources?.gatesFor?.(order.id)) ?? []
          const standing = await readStanding(order, {
            ...deps.standingSources,
            ...orderStandingSources(deps.store),
            gatesFor: async () => gates,
          })
          const holding =
            standing.turn === 'you' && standing.gateId !== null
              ? gates.find((gate) => gate.id === standing.gateId && gate.decision === null)
              : undefined
          return {
            id: order.id,
            title: order.title,
            status: order.status,
            createdAt: order.createdAt,
            risk: order.risk.grade,
            source: order.source,
            failures: compileOrder(order).failures.length,
            // Which order the tab's badge is counting. A number on the chrome
            // that sends you to a list saying nothing about where it came from
            // is a number you have to open every row to act on.
            openQuestions:
              order.status === 'draft' ? surfacedQuestions(order.openQuestions).length : 0,
            // Where the order actually stands. The row used to derive that from
            // `failures`, which is a draft-time compile result and therefore
            // zero for every running order for ever — so every running order,
            // including one halted at a gate two hours earlier, said "ready to
            // hand off".
            standing,
            // The one answer the operator owes, so the row can carry it. Only
            // what the buttons need: this list is polled.
            gate:
              holding === undefined
                ? null
                : { id: holding.id, options: holding.options, breach: holding.breach ?? null },
            // Absent when this host has never wired a records location for CI;
            // null once it has one and this order has not shipped a pull yet.
            ...(deps.dataRoot === undefined
              ? {}
              : {
                  ci: await readCiState(deps.dataRoot(), order.id).then((state) => {
                    if (state === null) return null
                    const checks = state.pulls.flatMap((pull) => pull.checks)
                    return {
                      status: state.status,
                      round: state.round,
                      max: state.max,
                      reason: state.reason,
                      checks: {
                        done: checks.filter((check) => check.bucket !== 'pending').length,
                        total: checks.length,
                      },
                    }
                  }),
                  // Where the pull requests are, for the link on the row.
                  pulls:
                    order.status === 'draft'
                      ? []
                      : (await readPulls(deps.dataRoot(), order.id)).map((pull) => ({
                          number: pullNumber(pull.url),
                          url: pull.url,
                        })),
                }),
            // Where this order stands in the refinery's file-overlap queue.
            // Null when it is not in a queue at all, or the host has never
            // wired the refinery.
            queue: queuePositions?.find((position) => position.orderId === order.id) ?? null,
          }
        })
      ),
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

  async function setBudgets(raw: unknown): Promise<unknown> {
    const parsed = BudgetsPayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }

    const order = await deps.store.load(parsed.data.id)
    if (order === null) return { error: `No order ${parsed.data.id}.` }
    if (order.status !== 'draft') {
      return {
        error: `${order.id} is ${order.status}. A running order's budget is raised at its budget gate.`,
      }
    }

    const next: WorkOrder = { ...order, budgets: { ...order.budgets, ...parsed.data.budgets } }
    await deps.store.save(next)
    await deps.store.record({
      at: deps.now(),
      orderId: order.id,
      actor: 'operator',
      action: 'budgets.configured',
      subject: order.id,
      reason: budgetsInWords(next.budgets),
      evidence: [],
    })
    return view(next)
  }

  /**
   * Choose the shape hand-off will run, overriding the proposal (FR-014).
   *
   * A draft only — a running order's recipe is fixed by `run.start`, and
   * changing it here would say one thing while the graph already cut ran
   * another.
   */
  async function recipe(raw: unknown): Promise<unknown> {
    const parsed = RecipePayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }

    const order = await deps.store.load(parsed.data.id)
    if (order === null) return { error: `No order ${parsed.data.id}.` }
    if (order.status !== 'draft') {
      return { error: `Only a draft can have its shape chosen; this order is ${order.status}.` }
    }

    const next: WorkOrder = { ...order, recipe: parsed.data.recipe }
    await deps.store.save(next)
    await deps.store.record({
      at: deps.now(),
      orderId: order.id,
      actor: 'operator',
      action: 'recipe.chosen',
      subject: order.id,
      reason: parsed.data.recipe ?? 'the proposal',
      evidence: [],
    })
    return view(next)
  }

  /**
   * Hold the loop for the operator, or release it.
   *
   * Recording the decision is all this channel does. What "release" actually
   * resumes — the next review round, a follow-up, hand-off — is
   * `deps.onReleased`'s job, over in the loop that knows what those are.
   */
  async function hold(raw: unknown): Promise<unknown> {
    const parsed = HoldPayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }

    const order = await deps.store.load(parsed.data.id)
    if (order === null) return { error: `No order ${parsed.data.id}.` }

    await deps.store.record({
      at: deps.now(),
      orderId: order.id,
      actor: 'operator',
      action: parsed.data.held ? 'review.held' : 'review.released',
      subject: order.id,
      reason: parsed.data.held ? 'held by the operator' : 'released by the operator',
      evidence: [],
    })

    if (!parsed.data.held) deps.onReleased?.(order)

    return view(order)
  }

  return {
    create,
    turn,
    compile,
    list,
    states,
    mapState,
    converge,
    setWriteBack,
    setBudgets,
    cancel,
    recipe,
    hold,
  }
}
