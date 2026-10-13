import type { ExtensionAPI } from '@terminator/extension-sdk'
import * as fs from 'node:fs'

import { rulesFor } from '../verify/rules.js'
import { ensureCheckout } from '../line/worktree.js'
import type { Checkout } from '../line/worktree.js'
import { issueOf, workspaceFor } from '../line/order-project.js'
import { resumableIn } from '../runtime/claude-launch.js'
import { architectModel, convergeBrief, readProposal } from './converge.js'
import type { ConvergeBrief } from './converge.js'
import type { ConvergeOutcome, ConvergeStarted } from '../ipc/forge-channels.js'
import type { Role } from '../recipe/parse.js'
import { collectableWrites, readRungOutput, rungOutputPath } from '../line/rung-output.js'
import { agentTitle } from '../runtime/agent-title.js'
import { resolveRole } from '../recipe/resolve.js'
import type { WorkOrder } from '../order/schema.js'
import type { OrderStore } from '../order/store.js'
import { orderDir } from '../data-root.js'
import type { StartSupervisedRunOptions, SupervisedRunner } from '../runtime/supervised-runner.js'

import { resolveSources } from '../workspace-root.js'
import { announceLive, orderStoreAt } from '../state/live-index.js'
import { intakeSessions, deletedOrders } from './intake-sessions.js'
import { askModel, modelForTier } from '../state/settings.js'
import { trustRepository, readOnlyAutoDecide } from '../runtime/agent-policy.js'
import { runtime } from '../runtime/runtime-state.js'
import { notePending, noteResolved } from '../runtime/held-calls.js'
import { shellExecOf } from '../host-calls.js'

/** One architect turn: the order, what it is told, and who hears how it ended. */
export interface ArchitectTurn {
  readonly root: string
  readonly order: WorkOrder
  readonly message: string
  readonly onFinished: (outcome: ConvergeOutcome) => Promise<void>
  // A review-loop turn carries the red team's findings as `message`, but it is
  // the architect fixing its own plan, not an ask — so it stays on the draft
  // model rather than the ask model. See `architectModel`.
  readonly loop?: boolean
}

/** What a started architect turn works with, and how far it has got. */
interface ArchitectLaunch {
  readonly api: ExtensionAPI
  readonly turn: ArchitectTurn
  readonly runner: SupervisedRunner
  readonly plan: ConvergeBrief
  readonly featureDir: string
  readonly checkout: Checkout
  readonly memory: SessionMemory
  readonly answer: (started: ConvergeStarted) => void
  readonly progress: { done: boolean; architectSession: string | null }
}

/** Where the architect works: its brief, its order's directory, and the lane checkout. */
type ArchitectPlace =
  | { ok: true; plan: ConvergeBrief; featureDir: string; checkout: Checkout }
  | { ok: false; reason: string }

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * One turn of intake, in a session the operator can see and type into.
 *
 * The architect runs read-only in the order's lane checkout — the one its
 * lanes will build in — so the whole order is one sidebar project (ADR-061).
 * It writes one file, and that file is
 * validated before any of it reaches the order — an agent that could write the
 * order directly could set its status and agree its own work.
 *
 * Resolves as soon as the architect is *running*, not when it finishes: a turn
 * takes minutes, and a channel that waited would hold the bridge for all of
 * them while the surface spun on a promise.
 */
export async function convergeOnce(
  api: ExtensionAPI,
  turn: ArchitectTurn
): Promise<ConvergeStarted> {
  const { order } = turn
  if (deletedOrders.has(order.id)) return { ok: false, reason: 'The order was deleted.' }
  const runner = runtime.supervisedRunner
  if (runner === null) {
    return { ok: false, reason: 'The supervision runtime is not running, so intake cannot start.' }
  }
  const place = await prepareArchitect(api, turn)
  if (!place.ok) return place
  const memory = rememberSessions(turn.root, order.id)
  return new Promise<ConvergeStarted>((resolve) => {
    let answered = false
    const answerOnce = (started: ConvergeStarted): void => {
      if (answered) return
      answered = true
      resolve(started)
    }
    const progress: ArchitectLaunch['progress'] = { done: false, architectSession: null }
    launchArchitect({ api, turn, runner, ...place, memory, answer: answerOnce, progress })
  })
}

async function prepareArchitect(api: ExtensionAPI, turn: ArchitectTurn): Promise<ArchitectPlace> {
  const { root, order } = turn
  const sources = resolveSources(api, root)
  let plan
  try {
    plan = convergeBrief({
      order,
      root,
      sources,
      rules: rulesFor(sources, {
        repoPaths: sources.repoPaths,
        houseDocs: [...order.context.houseDocs],
      }).rules,
      message: turn.message,
    })
  } catch (error) {
    return { ok: false, reason: reasonOf(error) }
  }
  const featureDir = orderDir(root, order.id)
  await fs.promises.mkdir(featureDir, { recursive: true })
  // The lane's own checkout, so the order is one project from its first turn
  // (ADR-061) and the architect reads the base the builder will change.
  try {
    const checkout = await ensureCheckout(order, 1, { exec: shellExecOf(api), root })
    return { ok: true, plan, featureDir, checkout }
  } catch (error) {
    return { ok: false, reason: reasonOf(error) }
  }
}

/** Writing the conversation onto the order, and waiting for that write. */
interface SessionMemory {
  readonly remember: (sessionId: string) => void
  readonly remembered: () => Promise<void>
}

/**
 * Write the conversation onto the order.
 *
 * `provenance.forgeSession` existed and nothing ever set it, so the Forge's
 * "Attach" — the way back into the conversation that wrote the plan — had
 * nothing to attach to and was never rendered.
 */
// The record loads the whole order and saves it back, so the turn's outcome
// waits for it: a save that landed after the amendment's put the old plan
// back, with the answered finding open again.
function rememberSessions(root: string, orderId: string): SessionMemory {
  let remembering: Promise<void> = Promise.resolve()
  const remember = (sessionId: string): void => {
    intakeSessions.set(orderId, sessionId)
    announceLive(orderId)
    remembering = remembering
      .then(async () => {
        const current = await orderStoreAt(root).load(orderId)
        if (current === null || current.provenance.forgeSession === sessionId) return
        await orderStoreAt(root).save({
          ...current,
          provenance: { ...current.provenance, forgeSession: sessionId },
        })
      })
      .catch(() => {
        // A record of which conversation this was is a courtesy. Losing it
        // must not fail the intake it is describing.
      })
  }
  return { remember, remembered: () => remembering }
}

function launchArchitect(launch: ArchitectLaunch): void {
  const { api, turn, memory, answer, progress } = launch
  const { order } = turn
  trustRepository(api, launch.plan.cwd, { orderId: order.id, store: orderStoreAt(turn.root) })
  void launch.runner
    .start(architectStartOptions(launch))
    .then((run) => {
      if (run === null) {
        collectProposal(launch, true, null)
        return
      }
      memory.remember(run.sessionId)
      answer({ ok: true, sessionId: run.sessionId })
    })
    .catch((error: unknown) => {
      progress.done = true
      intakeSessions.delete(order.id)
      announceLive(order.id)
      answer({
        ok: false,
        reason: error instanceof Error ? error.message : 'The architect could not be started.',
      })
    })
}

function architectStartOptions(launch: ArchitectLaunch): StartSupervisedRunOptions {
  const { api, turn, plan, checkout, featureDir } = launch
  const { order } = turn
  return {
    ...sessionPlace(api, { order, checkout, featureDir }),
    title: 'Architect',
    prompt: plan.prompt,
    phase: 'architect' as never,
    resumeSessionId: plan.role.allowResume
      ? resumableIn(checkout.path, resumingFor(order))
      : undefined,
    model: architectModel(
      turn.message,
      { draft: modelForTier(api, plan.role.modelTier), ask: askModel(api) },
      turn.loop === true ? { loop: true } : undefined
    ),
    // Read-only, enforced by the hook rather than by the prompt. The
    // architect proposes; it does not edit the repository it is reading.
    // Its one exception is the proposal itself, and only at that path.
    autoDecide: readOnlyAutoDecide(plan.proposalPath),
    // Intake is where questions belong, so one asked here is not a defect
    // — it is the Forge working.
    ...heldCallNotes(api, featureDir),
    onAutoDenied: (tool, reason) =>
      postRefusal(intakeSessions.get(order.id) ?? order.id, { tool, reason }),
    onRegistered: (run) => {
      launch.progress.architectSession = run.sessionId
      launch.memory.remember(run.sessionId)
      launch.answer({ ok: true, sessionId: run.sessionId })
    },
    onTurnEnd: () => collectProposal(launch, false, 0),
    onEnd: (exitCode) => collectProposal(launch, true, exitCode),
  }
}

// One conversation per order, so a follow-up does not make the architect
// read the repository again to answer "why not the other approach".
//
// The recorded one is the fallback: the in-memory map dies with the process,
// and an order reopened after a restart should still know which conversation
// produced it.
const resumingFor = (order: WorkOrder): string | undefined =>
  intakeSessions.get(order.id) ?? order.provenance.forgeSession ?? undefined

/** The parts of a Forge session's launch every read-only turn shares: where it runs. */
function sessionPlace(
  api: ExtensionAPI,
  where: { order: WorkOrder; checkout: Checkout; featureDir: string }
): Pick<
  StartSupervisedRunOptions,
  'featureDir' | 'worktreePath' | 'workspaceId' | 'branch' | 'issue'
> {
  const { order, checkout, featureDir } = where
  return {
    featureDir,
    worktreePath: checkout.path,
    workspaceId: workspaceFor(api.workspace?.list() ?? [], checkout.origin),
    branch: checkout.branch,
    issue: issueOf(order),
  }
}

function heldCallNotes(
  api: ExtensionAPI,
  featureDir: string
): Pick<StartSupervisedRunOptions, 'onPending' | 'onResolved'> {
  return {
    onPending: (pending) => notePending(api, { ...pending, featureDir }),
    onResolved: (requestId) => noteResolved(requestId),
  }
}

function postRefusal(sessionId: string, refused: { tool: string; reason: string }): void {
  runtime.supervision?.feed.post({
    at: Date.now(),
    sessionId,
    author: 'console',
    summary: `refused ${refused.tool}: ${refused.reason}`,
  })
}

/**
 * Take the proposal, if there is one to take.
 *
 * A turn ending is not the architect finishing: it thinks, replies, asks
 * something, and may write on a later turn. Reading at the first turn end
 * reported "the architect wrote no proposal" while it was still working,
 * so a turn only counts when the file is actually there. The session
 * ending is the deadline — then the answer is whatever it left, including
 * nothing.
 */
function collectProposal(launch: ArchitectLaunch, deadline: boolean, code: number | null): void {
  const { turn, plan, progress } = launch
  const { order } = turn
  if (progress.done || deletedOrders.has(order.id)) return
  if (!deadline && !fs.existsSync(plan.proposalPath)) return
  progress.done = true
  // The proposal is in, so the turn's terminal has nothing left to do. A
  // follow-up resumes the conversation in a fresh one.
  if (!deadline && progress.architectSession !== null) {
    launch.runner.stop(progress.architectSession)
  }
  // The session is over either way, so it must not be resumed: `--resume`
  // on one the runtime has forgotten silently starts a fresh agent that
  // believes it is continuing.
  if (deadline) {
    intakeSessions.delete(order.id)
    announceLive(order.id)
  }
  const outcome =
    !deadline || code !== null
      ? readProposal(order, plan.proposalPath, new Date().toISOString())
      : { ok: false as const, reason: 'The architect could not be started.' }
  void launch.memory.remembered().then(() => turn.onFinished(outcome))
  launch.answer({ ok: false, reason: 'The architect ended before it started.' })
}

/** One read-only round's request: which role, which node, and what to tell it. */
export interface ReadOnlyRound {
  readonly api: ExtensionAPI
  readonly root: string
  readonly order: WorkOrder
  readonly roleId: 'red-team' | 'scout'
  readonly nodeId: string
  readonly prompt: (role: Role) => string
  readonly startedAction: string
  readonly startedReason: string
  /** `anotherPass` is the red team asking to attack the fix for its findings. */
  readonly onFinished: (order: WorkOrder | null, anotherPass?: boolean) => Promise<void>
  /** Stamped onto every fresh finding — only meaningful for the red team. */
  readonly round?: number
  /**
   * Called the moment the round's session exists, before its turn ends.
   * Absent for a round nothing else needs to answer early for.
   */
  readonly onStarted?: (sessionId: string) => void
  /** Overrides the role's own tier, for a round the operator asked to keep light. */
  readonly model?: string
}

/** A round that has its role, its checkout and its output file, and how far it has got. */
interface RoundLaunch {
  readonly input: ReadOnlyRound
  readonly runner: SupervisedRunner
  readonly store: OrderStore
  readonly role: Role
  readonly featureDir: string
  readonly outputPath: string
  readonly checkout: Checkout
  readonly progress: { done: boolean; announced: boolean; roundSession: string | null }
}

/**
 * One read-only round in the Forge, before the order is agreed: the red
 * team's attack, or the scout's reconnaissance.
 *
 * The same mechanism as the architect's own turn — a session in the lane
 * checkout that writes one file back — reused for the two roles that only
 * ever read. See docs/research/foundry-red-team-loop.md ("Design → Loop").
 */
export async function readOnlyRound(input: ReadOnlyRound): Promise<void> {
  const { api, root, order } = input
  if (deletedOrders.has(order.id)) return
  const runner = runtime.supervisedRunner
  const store = orderStoreAt(root)
  if (runner === null) {
    await refuseRound(input, store, 'the supervision runtime is not running')
    return
  }
  const resolved = resolveRole(input.roleId, resolveSources(api, root))
  if (!resolved.ok) {
    await refuseRound(input, store, resolved.reason)
    return
  }
  const featureDir = orderDir(root, order.id)
  let checkout: Checkout
  try {
    checkout = await ensureCheckout(order, 1, { exec: shellExecOf(api), root })
  } catch (error) {
    await refuseRound(input, store, reasonOf(error))
    return
  }
  trustRepository(api, checkout.path, { orderId: order.id, store })
  const progress: RoundLaunch['progress'] = { done: false, announced: false, roundSession: null }
  const role = resolved.resolved.value
  const outputPath = rungOutputPath(featureDir, input.nodeId)
  startRound({ input, runner, store, role, featureDir, outputPath, checkout, progress })
}

function recordRound(
  input: ReadOnlyRound,
  store: OrderStore,
  entry: { action: string; reason: string; subject: string }
): Promise<void> {
  return store.record({
    at: new Date().toISOString(),
    orderId: input.order.id,
    actor: `role:${input.roleId}`,
    action: entry.action,
    subject: entry.subject,
    reason: entry.reason,
    evidence: [],
  })
}

async function refuseRound(input: ReadOnlyRound, store: OrderStore, reason: string): Promise<void> {
  await recordRound(input, store, {
    action: `${input.roleId}.refused`,
    reason,
    subject: input.order.id,
  })
  await input.onFinished(null)
}

function announceRound(launch: RoundLaunch, subject: string): void {
  const { input, progress } = launch
  if (progress.announced) return
  progress.announced = true
  void recordRound(input, launch.store, {
    action: input.startedAction,
    reason: input.startedReason,
    subject,
  })
  input.onStarted?.(subject)
}

function startRound(launch: RoundLaunch): void {
  const { input } = launch
  void launch.runner
    .start(roundStartOptions(launch))
    .then((run) => {
      if (run === null) {
        void collectRound(launch, true)
        return
      }
      announceRound(launch, run.sessionId)
    })
    .catch((error: unknown) => {
      void recordRound(input, launch.store, {
        action: `${input.roleId}.refused`,
        reason: reasonOf(error),
        subject: input.order.id,
      })
      void input.onFinished(null)
    })
}

function roundStartOptions(launch: RoundLaunch): StartSupervisedRunOptions {
  const { input, role, featureDir, checkout } = launch
  const { api, order, roleId } = input
  return {
    ...sessionPlace(api, { order, checkout, featureDir }),
    title: agentTitle(roleId),
    prompt: input.prompt(role),
    phase: roleId,
    model: input.model ?? modelForTier(api, role.modelTier),
    // Read-only, enforced by the hook rather than by the prompt, with the
    // one exception being the rung's own output file.
    autoDecide: readOnlyAutoDecide(launch.outputPath),
    ...heldCallNotes(api, featureDir),
    onAutoDenied: (tool, reason) => postRefusal(order.id, { tool, reason }),
    onRegistered: (run) => {
      launch.progress.roundSession = run.sessionId
      announceRound(launch, run.sessionId)
    },
    onTurnEnd: () => void collectRound(launch, false),
    onEnd: () => void collectRound(launch, true),
  }
}

async function collectRound(launch: RoundLaunch, deadline: boolean): Promise<void> {
  const { input, store, progress, outputPath } = launch
  const { order, roleId } = input
  if (progress.done || deletedOrders.has(order.id)) return
  if (!deadline && !fs.existsSync(outputPath)) return
  progress.done = true
  // Read-only and one turn: once its file is in, the round is over.
  if (!deadline && progress.roundSession !== null) launch.runner.stop(progress.roundSession)
  const current = (await store.load(order.id)) ?? order
  const result = readRungOutput({
    order: current,
    role: roleId,
    writes: collectableWrites(launch.role),
    outputPath,
    at: new Date().toISOString(),
    round: input.round,
  })
  if (result === null) {
    await refuseRound(input, store, `the ${roleId} wrote nothing`)
    return
  }
  if (!result.ok) {
    await refuseRound(input, store, result.reason)
    return
  }
  await store.save(result.order)
  await input.onFinished(result.order, result.anotherPass)
}
