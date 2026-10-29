import { z } from 'zod'
import { orderDir } from '../data-root.js'
import { seedOrder, newOrderId } from '../forge/intake-source.js'
import { defaultHintsDir } from '../profile/hints.js'
import type { IssueLike, SeedInput } from '../forge/intake-source.js'
import { answerQuestion, surfacedQuestions } from '../forge/interview.js'
import { strikeAssumption } from '../forge/assumptions.js'
import { applyFindings, acceptFinding } from '../forge/red-team.js'
import { compileOrder, agreeOrder } from '../order/compile.js'
import type { OrderStore } from '../order/store.js'
import { documentLinkOf } from '../line/document-outcome.js'
import { readStanding } from '../order/standing.js'
import { orderStandingSources } from '../order/order-standing-sources.js'
import {
  currentIntake,
  loopFacts,
  agreedFacts,
  environmentWaivedAt,
  checkDecisions,
  CHECKS_CONTINUE_UNMEASURED,
  PICTURES_DECLINED,
  turnEndedAt as turnEndedAtOf,
} from '../forge/intake-outcome.js'
import type { IntakeOutcome } from '../forge/intake-outcome.js'
import { environmentRefusal } from '../forge/readiness.js'
import { proposeRecipe } from './run-channels.js'
import type { LoopFacts, AgreedFacts, EnvironmentFacts } from '../forge/readiness.js'
import { isProving, readBaseline } from '../line/baseline.js'
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
import { noPayload, type ChannelSpec } from '@terminator/extension-sdk'
import { foundryChannel } from './channel.js'
import { isLiveSession } from '../runtime/runtime-state.js'

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
    tracker: z.enum(['linear']).optional(),
    key: z.string().optional(),
  }),
  repoPaths: z.array(z.string()),
})

const CancelPayload = z.object({
  id: z.string(),
  reason: z.string().optional(),
})

/** A typed answer, one option index, or several indices for a multiple-choice question. */
const AnswerOption = z.union([z.string(), z.number(), z.array(z.number().int())])

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
  answers: z.array(z.object({ questionId: z.string(), option: AnswerOption })).optional(),
  accepts: z.array(z.object({ findingId: z.string(), reason: z.string() })).optional(),
  fixes: z.array(z.object({ findingId: z.string(), how: z.string() })).optional(),
  asks: z.array(z.string()).optional(),
})

type SettleInput = z.infer<typeof SettlePayload>

const TurnPayload = z.object({
  id: z.string(),
  message: z.string().optional(),
  strike: z.string().optional(),
  answer: z.object({ questionId: z.string(), option: AnswerOption }).optional(),
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

export const CompilePayload = z.object({
  id: z.string(),
  commit: z.boolean().default(false),
  /** Foundry agreeing an order the operator already released, after an amendment. */
  automatic: z.boolean().default(false),
})

const RecipePayload = z.object({ id: z.string(), recipe: z.string().nullable() })
const HoldPayload = z.object({ id: z.string(), held: z.boolean() })
const OrderIdOnly = z.object({ id: z.string() })
const EnvironmentPayload = z.object({
  id: z.string(),
  move: z.enum(['check', 'waive', 'continue-unmeasured', 'decline-pictures']),
})

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
   * them in the order record.
   */
  readonly standingSources: StandingSources & Required<Pick<StandingSources, 'gatesFor'>>
  readonly readIssue: (tracker: 'linear', key: string) => Promise<IssueLike | null>
  /**
   * Which write-backs a new order starts with (FR-062), from configuration.
   *
   * A function, like the other two below: these channels are built once when
   * the extension activates, and a value read then is the value the operator
   * had at start-up rather than the one they have now.
   */
  readonly writeBackDefault: () => readonly WriteBack[]
  /**
   * The budgets a new order starts with (FR-030), from configuration.
   *
   * A default, not a ceiling: the operator may change them per order, and the
   * architect may not.
   */
  readonly budgetDefaults: () => Omit<Budgets, 'tokens'>
  /**
   * The paths the operator declared critical (FR-043). Workspace-scoped and
   * operator-declared: Foundry never infers this list, and an order that
   * cannot see it grades a change to a critical path as if it were ordinary.
   */
  readonly criticalPaths: (repoPaths: readonly string[]) => readonly string[]
  /** Past decisions about the files a new idea names (FR-077). */
  readonly priorArtFor: (paths: readonly string[]) => Promise<string[]>
  // Starts one intake turn and resolves once it is running, not after the minutes it
  // takes; the redraft lands later through the store. `recordStart` writes the start
  // to the ledger, and the turn's end waits for it so the redraft never precedes it.
  readonly converge: (
    order: WorkOrder,
    message: string,
    recordStart: (started: ConvergeStarted) => Promise<void>
  ) => Promise<ConvergeStarted>
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
   * location follows the open workspace.
   */
  readonly dataRoot: () => string
  /**
   * Every in-flight order's queue entries, for the refinery's file-overlap
   * queue: the list's `queue` field, and the advisory shown on agreement.
   */
  readonly queueEntries: () => Promise<readonly QueueEntry[]>
  /**
   * The side effect of releasing a hold: pick the loop back up.
   *
   * Kept out of this file on purpose — `hold` only records the ledger line
   * and hands back the view, the same as every other channel here. What
   * "release" actually resumes (start the next review round, send a
   * follow-up, hand off) is the loop's own business, in `src/index.ts`.
   */
  readonly onReleased: (order: WorkOrder) => void
  /** Prove the base branch builds and passes its checks. Never throws. */
  readonly proveEnvironment?: (order: WorkOrder) => Promise<void>
}

export interface ForgeChannels {
  /** Run one turn of intake: the architect drafts, or redrafts, the plan. */
  converge(payload: z.infer<typeof TurnPayload>): ReturnType<typeof converge>
  create(payload: z.infer<typeof CreatePayload>): ReturnType<typeof create>
  turn(payload: z.infer<typeof TurnPayload>): ReturnType<typeof turn>
  compile(payload: z.infer<typeof CompilePayload>): ReturnType<typeof compile>
  list(): ReturnType<typeof list>
  /** The candidate states, for the operator to map intents against. */
  states(payload: z.infer<typeof StatesPayload>): ReturnType<typeof states>
  /** Record which state one intent means for this order. */
  mapState(payload: z.infer<typeof MapStatePayload>): ReturnType<typeof mapState>
  /** Turn each write-back on or off for this order (FR-062). */
  setWriteBack(payload: z.infer<typeof WriteBackPayload>): ReturnType<typeof setWriteBack>
  /** Set a draft order's budgets. Null is no limit. */
  setBudgets(payload: z.infer<typeof BudgetsPayload>): ReturnType<typeof setBudgets>
  /** Discard an order that should not have been made. */
  cancel(payload: z.infer<typeof CancelPayload>): ReturnType<typeof cancel>
  /** Choose which shape hand-off will run (FR-014's override). */
  recipe(payload: z.infer<typeof RecipePayload>): ReturnType<typeof recipe>
  /** Hold the loop for the operator, or release it. */
  hold(payload: z.infer<typeof HoldPayload>): ReturnType<typeof hold>
  /** Pick the loop up where it stopped, without recording a hold or a release. */
  resume(payload: z.infer<typeof OrderIdOnly>): ReturnType<typeof resume>
  /** Check the base branch again, or hand off without it. */
  environment(payload: z.infer<typeof EnvironmentPayload>): ReturnType<typeof environment>
}

/** The order plus its checks — what every Forge channel hands back. */
function view(order: WorkOrder, changed: string[] = []) {
  return { order, compile: compileOrder(order), changed }
}

/**
 * The backend facts the redesigned Forge reads, from one read of the ledger.
 *
 * Every response that used to carry `intake` alone now carries these five
 * together — one function so no call site can add a fifth response that
 * forgets one of them, the way `intake` alone was added in three places and
 * a fourth was missed.
 */
async function readFacts(
  deps: Pick<ForgeDeps, 'store' | 'dataRoot'>,
  orderId: string
): Promise<{
  intake: IntakeOutcome
  loop: LoopFacts
  agreed: AgreedFacts | null
  turnEndedAt: string | null
  environment: EnvironmentFacts
}> {
  const entries = await deps.store.entries(orderId)
  const order = await deps.store.load(orderId)
  const baseline = await readBaseline(deps.dataRoot(), orderId)
  return {
    intake: currentIntake(entries, order?.intake, { now: Date.now(), isLive: isLiveSession }),
    loop: loopFacts(entries),
    agreed: agreedFacts(entries),
    turnEndedAt: turnEndedAtOf(entries),
    environment: {
      baseline,
      waivedAt: environmentWaivedAt(entries, baseline?.startedAt ?? null),
      proving: isProving(orderId),
      decisions: checkDecisions(entries),
    },
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
  return {
    create: (payload) => create(deps, payload),
    turn: (payload) => turn(deps, payload),
    compile: (payload) => compile(deps, payload),
    list: () => list(deps),
    states: (payload) => states(deps, payload),
    mapState: (payload) => mapState(deps, payload),
    converge: (payload) => converge(deps, payload),
    setWriteBack: (payload) => setWriteBack(deps, payload),
    setBudgets: (payload) => setBudgets(deps, payload),
    cancel: (payload) => cancel(deps, payload),
    recipe: (payload) => recipe(deps, payload),
    hold: (payload) => hold(deps, payload),
    resume: (payload) => resume(deps, payload),
    environment: (payload) => environment(deps, payload),
  }
}

type CreateInput = z.infer<typeof CreatePayload>

/** What the operator started an order from, as the seeding reads it. */
function seedInput({ source, repoPaths }: CreateInput): SeedInput {
  if (source.kind === 'tracker') {
    return {
      kind: 'tracker',
      tracker: source.tracker ?? 'linear',
      key: source.key ?? '',
      repoPaths,
    }
  }
  return { kind: 'typed', text: source.text ?? '', repoPaths }
}

async function create(deps: ForgeDeps, payload: CreateInput) {
  const seeded = await seedOrder(seedInput(payload), {
    now: deps.now,
    newId: () => newOrderId(new Date(deps.now())),
    readIssue: deps.readIssue,
    priorArtFor: deps.priorArtFor,
    profile: { dataRoot: deps.dataRoot(), hintsDir: defaultHintsDir() },
  })

  if ('error' in seeded) return seeded

  const existing = await existingFor(deps, seeded.order)
  if (existing !== null) return { existing }

  // The adversarial pass runs on the first draft, not only at the end: a
  // finding the operator sees now is cheaper than one that reopens an order
  // they thought was settled.
  const attacked = applyFindings(configured(deps, seeded.order, payload.repoPaths), deps.now())
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
  // Minutes of work on the base branch, which the operator reads when it lands.
  void deps.proveEnvironment?.(attacked)

  return { ...view(attacked), unavailableChecks: seeded.unavailableChecks }
}

// The order already drafted from the same tracker issue, if any. It reads the store,
// so it lives here and seeding stays a pure function of its inputs.
async function existingFor(
  deps: ForgeDeps,
  order: WorkOrder
): Promise<{ id: string; title: string } | null> {
  const { tracker, key } = order.source
  if (tracker === null || key === null) return null
  return deps.store.findByIssue(tracker, key)
}

/** A seeded order with this workspace's write-back, budgets and its repositories' critical paths. */
function configured(deps: ForgeDeps, order: WorkOrder, repoPaths: readonly string[]): WorkOrder {
  return {
    ...order,
    writeBack: [...deps.writeBackDefault()],
    budgets: { ...order.budgets, ...deps.budgetDefaults() },
    risk: { ...order.risk, criticalPaths: [...deps.criticalPaths(repoPaths)] },
  }
}

/** Writes one line the operator's own decision put on an order's ledger. */
function recordOperator(
  deps: ForgeDeps,
  orderId: string,
  line: { action: string; subject: string; reason: string }
): Promise<void> {
  return deps.store.record({ at: deps.now(), orderId, actor: 'operator', ...line, evidence: [] })
}

type TurnInput = z.infer<typeof TurnPayload>

async function turn(deps: ForgeDeps, payload: TurnInput) {
  const { id, strike, answer, finding, unverifiable, message } = payload
  const order = await deps.store.load(id)
  if (order === null) return { error: `No order ${id}.` }
  if (strike !== undefined) return strikeTurn(deps, order, strike)
  if (finding !== undefined) return findingTurn(deps, order, finding)
  if (unverifiable !== undefined) return unverifiableTurn(deps, order, unverifiable)
  if (answer !== undefined) return answerTurn(deps, order, answer)
  // Free text goes to the architect, which is the whole conversational half
  // of the Forge. It used to return the order unchanged with a comment
  // saying the text had gone to an agent session; there was no agent.
  if (message !== undefined && message.trim() !== '') return converge(deps, { id, message })
  return view(order)
}

async function strikeTurn(deps: ForgeDeps, order: WorkOrder, strike: string) {
  const result = strikeAssumption(order, strike)
  await deps.store.save(result.order)
  await recordOperator(deps, order.id, {
    action: 'assumption.struck',
    subject: strike,
    reason: `redraw ${result.redraw.join(', ') || 'nothing'}`,
  })
  return view(result.order, [...result.redraw])
}

async function findingTurn(
  deps: ForgeDeps,
  order: WorkOrder,
  { id: findingId, decision, reason }: NonNullable<TurnInput['finding']>
) {
  if (reason.trim() === '') {
    // An accepted finding with no reason is a shrug, and the compile check
    // would refuse it anyway — said here rather than silently ignored.
    return { ...view(order), error: 'Accepting a finding costs a written reason.' }
  }
  const next = acceptFinding(order, findingId, reason)
  await deps.store.save(next)
  await recordOperator(deps, order.id, {
    action: `finding.${decision}`,
    subject: findingId,
    reason: reason.trim(),
  })
  return view(next, ['redTeam'])
}

async function unverifiableTurn(
  deps: ForgeDeps,
  order: WorkOrder,
  { criterionId, reason }: NonNullable<TurnInput['unverifiable']>
) {
  if (reason.trim() === '') {
    // The schema refuses an empty reason too, but it would refuse it as a
    // malformed order rather than as the thing it is: an accepted
    // unverifiable with no reason is a shrug, and the operator is told so.
    return { ...view(order), error: 'Accepting a criterion as unverifiable costs a reason.' }
  }
  if (!order.acceptance.some((criterion) => criterion.id === criterionId)) {
    return { ...view(order), error: `No criterion ${criterionId} in this order.` }
  }
  const accepted = { accepted: true as const, reason: reason.trim() }
  const next: WorkOrder = {
    ...order,
    acceptance: order.acceptance.map((criterion) =>
      criterion.id === criterionId ? { ...criterion, unverifiable: accepted } : criterion
    ),
  }
  await deps.store.save(next)
  await recordOperator(deps, order.id, {
    action: 'criterion.unverifiable',
    subject: criterionId,
    reason: reason.trim(),
  })
  return view(next, ['acceptance'])
}

type Answer = NonNullable<TurnInput['answer']>

async function answerTurn(deps: ForgeDeps, order: WorkOrder, answer: Answer) {
  const next: WorkOrder = {
    ...order,
    openQuestions: answerQuestion(order.openQuestions, answer.questionId, answer.option),
  }
  await deps.store.save(next)
  await recordOperator(deps, order.id, answeredLine(answer))
  return view(next, [answer.questionId])
}

function answeredLine(answer: Answer): { action: string; subject: string; reason: string } {
  return { action: 'question.answered', subject: answer.questionId, reason: String(answer.option) }
}

function recordArchitectStart(
  deps: ForgeDeps,
  { order, message }: { order: WorkOrder; message: string | undefined },
  started: ConvergeStarted
): Promise<void> {
  return deps.store.record({
    at: deps.now(),
    orderId: order.id,
    actor: 'role:architect',
    action: started.ok ? 'converge.started' : 'converge.refused',
    subject: started.ok ? started.sessionId : order.id,
    reason: started.ok ? (message === undefined ? 'drafting the plan' : message) : started.reason,
    evidence: [],
  })
}

// Start one architect turn on the order with the message given: shared by a plain
// turn and a settle ending in a fix or an ask, so one place starts and records it.
async function runArchitectTurn(deps: ForgeDeps, order: WorkOrder, message?: string) {
  // Once, from inside the turn when the architect starts, or here when
  // `converge` answered without starting one.
  let recorded: Promise<void> | null = null
  const recordConvergeStart = (s: ConvergeStarted): Promise<void> =>
    (recorded ??= recordArchitectStart(deps, { order, message }, s))
  const started = await deps.converge(order, message ?? '', recordConvergeStart)
  await recordConvergeStart(started)
  if (!started.ok) {
    return {
      ...view(order),
      error: started.reason,
      ...(await readFacts(deps, order.id)),
    }
  }

  // The order and the architect's session, so the surface can say it is running and
  // go there. `intake` comes back here too, not only on the poll: the Forge reads from
  // it whether a turn runs, and without it would sit idle until a poll never started.
  return {
    ...view(order),
    converging: started.sessionId,
    ...(await readFacts(deps, order.id)),
  }
}

// Settle everything decided in the band in one submit: answers and accepts change the
// order and are recorded as `turn` records them; all fixes and asks fold into one
// architect turn. A blank accept reason refuses the whole batch, not part of it.
async function settleTurn(
  deps: ForgeDeps,
  order: WorkOrder,
  { settle, message }: { settle: SettleInput; message: string | undefined }
) {
  const accepts = settle.accepts ?? []
  if (accepts.some((a) => a.reason.trim() === '')) {
    return { ...view(order), error: 'Accepting a finding costs a written reason.' }
  }
  const answers = settle.answers ?? []
  const next = await applySettled(deps, order, { answers, accepts })
  const fixes = settle.fixes ?? []
  const asks = settle.asks ?? []
  if (fixes.length === 0 && asks.length === 0) {
    const changed = [
      ...answers.map((a) => a.questionId),
      ...(accepts.length > 0 ? ['redTeam'] : []),
    ]
    return view(next, changed)
  }
  return runArchitectTurn(deps, next, fixMessage(next, { fixes, asks, message }))
}

type Settled = Pick<Required<SettleInput>, 'answers' | 'accepts'>

/** The answers and accepts of a settle, on the order and the ledger. */
async function applySettled(
  deps: ForgeDeps,
  order: WorkOrder,
  { answers, accepts }: Settled
): Promise<WorkOrder> {
  let next = order
  for (const answer of answers) {
    next = {
      ...next,
      openQuestions: answerQuestion(next.openQuestions, answer.questionId, answer.option),
    }
  }
  for (const accept of accepts) next = acceptFinding(next, accept.findingId, accept.reason)
  if (next === order) return next
  await deps.store.save(next)
  for (const answer of answers) await recordOperator(deps, order.id, answeredLine(answer))
  for (const accept of accepts) {
    await recordOperator(deps, order.id, {
      action: 'finding.accepted',
      subject: accept.findingId,
      reason: accept.reason.trim(),
    })
  }
  return next
}

/** The one message that carries every fix and ask of a settle to the architect. */
function fixMessage(
  order: WorkOrder,
  {
    fixes,
    asks,
    message,
  }: Pick<Required<SettleInput>, 'fixes' | 'asks'> & { message: string | undefined }
): string {
  const findingText = (id: string): string => order.redTeam.find((f) => f.id === id)?.text ?? ''
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
  return message === undefined || message.trim() === ''
    ? parts.join(' ')
    : `${parts.join(' ')} ${message}`
}

// One intake turn: the architect reads the draft and the repository and proposes
// criteria, plan, risk and budgets, read-only, in one file validated before it
// reaches the order, so no agent can set its own status or agree its own work.
async function converge(deps: ForgeDeps, payload: z.infer<typeof TurnPayload>) {
  const id = payload.id
  const order = await deps.store.load(id)
  if (order === null) return { error: `No order ${id}.` }
  if (order.status !== 'draft') {
    return { error: `Only a draft can be converged; this order is ${order.status}.` }
  }

  if (payload.settle !== undefined) {
    return settleTurn(deps, order, { settle: payload.settle, message: payload.message })
  }

  return runArchitectTurn(deps, order, payload.message)
}

/** What compile answers when it read the order: the facts, and what hand-off added. */
type CompileAnswer = Awaited<ReturnType<typeof readFacts>> & {
  compile: ReturnType<typeof compileOrder>
  order: WorkOrder
  refused?: string
  capability?: CapabilityReport
  advisory?: string | null
}

async function compile(
  deps: ForgeDeps,
  payload: z.infer<typeof CompilePayload>
): Promise<CompileAnswer | { error: string }> {
  const { id, commit, automatic } = payload

  const order = await deps.store.load(id)
  if (order === null) return { error: `No order ${id}.` }

  const result = compileOrder(order)
  // How the last intake turn ended, on the read the Forge polls: a refusal is only in
  // the ledger, and without this "working" and "finished, nothing accepted" look alike.
  const facts = await readFacts(deps, id)
  if (!commit || !result.ok) return { compile: result, order, ...facts }

  // Hand-off waits for the base branch check here too, so no caller can go around the Forge's row.
  const refused = environmentRefusal(facts.environment, order.recipe ?? proposeRecipe(order).name)
  if (refused !== null) return { compile: result, order, ...facts, refused }

  const agreed = agreeOrder(order, deps.now())
  if (!agreed.ok) return { compile: agreed.result, order, ...facts }

  await deps.store.save(agreed.order)
  await recordAgreed(deps, id, automatic)
  const capability = await afterAgreed(deps, agreed.order)

  // What this order is about to queue behind, if anything — said once, at
  // the moment it becomes real work, rather than left for the operator to
  // discover as a merge conflict later.
  const advisory = advisoryForOrder(agreed.order, await deps.queueEntries())

  return {
    compile: compileOrder(agreed.order),
    order: agreed.order,
    // Recomputed rather than reused: the ledger line just written is the
    // agreement this response is about, and the read above predates it.
    ...(await readFacts(deps, id)),
    capability,
    advisory,
  }
}

/** The ledger line of an agreement, the operator's or the Forge's own. */
function recordAgreed(deps: ForgeDeps, id: string, automatic: boolean | undefined): Promise<void> {
  return deps.store.record({
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
}

// What the tracker offers an agreed order, after telling it so. Neither may unmake
// an agreement already recorded (FR-063).
async function afterAgreed(
  deps: ForgeDeps,
  order: WorkOrder
): Promise<CapabilityReport | undefined> {
  let capability: CapabilityReport | undefined
  try {
    capability = await deps.capability?.(order)
  } catch {
    capability = undefined
  }
  try {
    await deps.onAgreed?.(order)
  } catch {
    // Recorded by the write-back itself; the order is agreed regardless.
  }
  return capability
}

// What the tracker offers, for the mapping panel. Its own channel because compile is
// polled and this is a network read that would spend the operator's rate limit.
async function states(deps: ForgeDeps, payload: z.infer<typeof StatesPayload>) {
  const order = await deps.store.load(payload.id)
  if (order === null) return { error: `No order ${payload.id}.` }
  if (deps.capability === undefined) {
    const capability: CapabilityReport = { transitions: 'no_issue', states: [], unreachable: [] }
    return { capability }
  }
  try {
    return { capability: await deps.capability(order), mapping: order.stateMapping }
  } catch (error) {
    return { error: (error as Error).message }
  }
}

async function mapState(deps: ForgeDeps, payload: z.infer<typeof MapStatePayload>) {
  const { id, intent, optionId } = payload

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

// Discard an order: marked `cancelled`, not deleted, because the records are the
// point. A running order is refused: its agents' work is in their worktrees, so
// stop it at its gate first.
async function cancel(deps: ForgeDeps, payload: z.infer<typeof CancelPayload>) {
  const order = await deps.store.load(payload.id)
  if (order === null) return { error: `No order ${payload.id}.` }
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
    reason: payload.reason ?? 'Discarded by the operator.',
    evidence: [],
  })
  return view(next)
}

/** Every order still to be done, each with where it stands. */
async function list(deps: ForgeDeps) {
  const orders = await deps.store.list()
  // A discarded order stays in the records and leaves the list; the list is
  // what needs doing, not what was ever asked for.
  const live = orders.filter((order) => order.status !== 'cancelled')
  // Computed once for the whole list rather than per row: every row's
  // queue position comes from the same set of in-flight orders.
  const queuePositions = queue(await deps.queueEntries())
  return {
    orders: await Promise.all(live.map((order) => listRow(deps, order, queuePositions))),
  }
}

async function listRow(
  deps: ForgeDeps,
  order: WorkOrder,
  queuePositions: ReturnType<typeof queue>
) {
  const { standing, gate } = await rowStanding(deps, order)
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
    openQuestions: order.status === 'draft' ? surfacedQuestions(order.openQuestions).length : 0,
    // Where the order stands, not derived from `failures`, a draft-time count that
    // called every running order "ready to hand off".
    standing,
    gate,
    // Null once a records location exists and this order has not shipped
    // a pull yet.
    ci: await rowCi(deps, order.id),
    pulls: await rowPulls(deps, order),
    document: documentLinkOf(order, orderDir(deps.dataRoot(), order.id)),
    // Where this order stands in the refinery's file-overlap queue.
    // Null when it is not in a queue at all.
    queue: queuePositions.find((position) => position.orderId === order.id) ?? null,
  }
}

/** Where a row's order stands, and the one answer the operator owes on it. */
async function rowStanding(deps: ForgeDeps, order: WorkOrder) {
  // Read once: the standing needs the order's gates to say whose move
  // it is, and the row needs the open one to put its answers on the line.
  const gates = await deps.standingSources.gatesFor(order.id)
  const standing = await readStanding(order, {
    ...deps.standingSources,
    ...orderStandingSources(deps.store),
    gatesFor: async () => gates,
  })
  const holding =
    standing.turn === 'you' && standing.gateId !== null
      ? gates.find((gate) => gate.id === standing.gateId && gate.decision === null)
      : undefined
  // The one answer the operator owes, so the row can carry it. Only
  // what the buttons need: this list is polled.
  const gate =
    holding === undefined
      ? null
      : { id: holding.id, options: holding.options, breach: holding.breach ?? null }
  return { standing, gate }
}

/** A row's CI round in brief: how far its checks have got. */
async function rowCi(deps: ForgeDeps, orderId: string) {
  const state = await readCiState(deps.dataRoot(), orderId)
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
}

/** Where a row's pull requests are, for the link on the row. */
async function rowPulls(
  deps: ForgeDeps,
  order: WorkOrder
): Promise<{ number: number; url: string }[]> {
  if (order.status === 'draft') return []
  const pulls = await readPulls(deps.dataRoot(), order.id)
  return pulls.map((pull) => ({ number: pullNumber(pull.url), url: pull.url }))
}

// Which write-backs this order does: per order, defaulting from configuration
// (FR-062), so one run against someone else's repository can turn one off alone.
async function setWriteBack(deps: ForgeDeps, payload: z.infer<typeof WriteBackPayload>) {
  const order = await deps.store.load(payload.id)
  if (order === null) return { error: `No order ${payload.id}.` }

  const next: WorkOrder = { ...order, writeBack: payload.writeBack }
  await deps.store.save(next)
  await deps.store.record({
    at: deps.now(),
    orderId: payload.id,
    actor: 'operator',
    action: 'writeback.configured',
    subject: payload.id,
    reason:
      payload.writeBack.length === 0
        ? 'nothing is written back to the tracker'
        : payload.writeBack.join(', '),
    evidence: [],
  })
  return view(next, ['writeBack'])
}

async function setBudgets(deps: ForgeDeps, payload: z.infer<typeof BudgetsPayload>) {
  const order = await deps.store.load(payload.id)
  if (order === null) return { error: `No order ${payload.id}.` }
  if (order.status !== 'draft') {
    return {
      error: `${order.id} is ${order.status}. A running order's budget is raised at its budget gate.`,
    }
  }

  const next: WorkOrder = { ...order, budgets: { ...order.budgets, ...payload.budgets } }
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

// Choose the shape hand-off will run, overriding the proposal (FR-014). A draft only:
// a running order's recipe was fixed by `run.start`.
async function recipe(deps: ForgeDeps, payload: z.infer<typeof RecipePayload>) {
  const order = await deps.store.load(payload.id)
  if (order === null) return { error: `No order ${payload.id}.` }
  if (order.status !== 'draft') {
    return { error: `Only a draft can have its shape chosen; this order is ${order.status}.` }
  }

  const next: WorkOrder = { ...order, recipe: payload.recipe }
  await deps.store.save(next)
  await deps.store.record({
    at: deps.now(),
    orderId: order.id,
    actor: 'operator',
    action: 'recipe.chosen',
    subject: order.id,
    reason: payload.recipe ?? 'the proposal',
    evidence: [],
  })
  return view(next)
}

// Picks the loop up where it stopped, e.g. a red-team round that could not start: the
// same next step a release takes, with no hold to record.
async function resume(deps: ForgeDeps, payload: z.infer<typeof OrderIdOnly>) {
  const order = await deps.store.load(payload.id)
  if (order === null) return { error: `No order ${payload.id}.` }
  deps.onReleased(order)
  return view(order)
}

// Hold the loop for the operator, or release it. This only records the decision;
// what release resumes is `deps.onReleased`'s job, in the loop.
async function hold(deps: ForgeDeps, payload: z.infer<typeof HoldPayload>) {
  const order = await deps.store.load(payload.id)
  if (order === null) return { error: `No order ${payload.id}.` }

  await deps.store.record({
    at: deps.now(),
    orderId: order.id,
    actor: 'operator',
    action: payload.held ? 'review.held' : 'review.released',
    subject: order.id,
    reason: payload.held ? 'held by the operator' : 'released by the operator',
    evidence: [],
  })

  if (!payload.held) deps.onReleased(order)

  return view(order)
}

const WAIVED_REASON =
  'Handed off without a proven base branch; checks that fail there will read "failing on base".'

/** What each move that is not a re-check writes to the order's ledger. */
const MOVE_RECORDS: Record<
  Exclude<z.infer<typeof EnvironmentPayload>['move'], 'check'>,
  { action: string; reason: string }
> = {
  waive: { action: 'environment.waived', reason: WAIVED_REASON },
  'continue-unmeasured': {
    action: CHECKS_CONTINUE_UNMEASURED,

    reason: 'Went on with nothing measured: no command was found and none was given.',
  },
  'decline-pictures': {
    action: PICTURES_DECLINED,

    reason: 'Ships without pictures although the plan changes the interface.',
  },
}

// Check the base branch again, or hand off without it. A check runs on after the answer;
// the Forge reads its result when baseline.json announces.
async function environment(deps: ForgeDeps, payload: z.infer<typeof EnvironmentPayload>) {
  const order = await deps.store.load(payload.id)
  if (order === null) return { error: `No order ${payload.id}.` }
  if (order.status !== 'draft') {
    return { error: 'Only a draft order can check its base branch again.' }
  }

  if (payload.move === 'check') void deps.proveEnvironment?.(order)
  else await recordOperator(deps, order.id, { ...MOVE_RECORDS[payload.move], subject: order.id })

  return { ...view(order), ...(await readFacts(deps, order.id)) }
}

/** The Forge's channels, each with the schema its payload is parsed with (ADR 096). */
export function forgeChannelSpecs(forge: ForgeChannels): ChannelSpec[] {
  return [
    foundryChannel('foundry:order.create', CreatePayload, forge.create),
    foundryChannel('foundry:order.turn', TurnPayload, forge.turn),
    foundryChannel('foundry:order.compile', CompilePayload, forge.compile),
    foundryChannel('foundry:order.list', noPayload, forge.list),
    foundryChannel('foundry:order.states', StatesPayload, forge.states),
    foundryChannel('foundry:order.mapState', MapStatePayload, forge.mapState),
    foundryChannel('foundry:order.converge', TurnPayload, forge.converge),
    foundryChannel('foundry:order.writeBack', WriteBackPayload, forge.setWriteBack),
    foundryChannel('foundry:order.budgets', BudgetsPayload, forge.setBudgets),
    foundryChannel('foundry:order.cancel', CancelPayload, forge.cancel),
    foundryChannel('foundry:order.recipe', RecipePayload, forge.recipe),
    foundryChannel('foundry:order.hold', HoldPayload, forge.hold),
    foundryChannel('foundry:order.resume', OrderIdOnly, forge.resume),
    foundryChannel('foundry:forge.environment', EnvironmentPayload, forge.environment),
  ]
}
