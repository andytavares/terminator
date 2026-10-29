import type { ExtensionAPI } from '@terminator/extension-sdk'
import * as fs from 'node:fs'

import { rulesFor } from '../verify/rules.js'
import { ensureCheckout } from '../line/worktree.js'
import type { Checkout } from '../line/worktree.js'
import { issueOf, workspaceFor } from '../line/order-project.js'
import { resumableIn } from '../runtime/claude-launch.js'
import { architectModel, convergeBrief, applyArchitectAnswer } from './converge.js'
import type { ConvergeBrief, ConvergeResult } from './converge.js'
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
import {
  askModel,
  autonomyFor,
  letAutoModeDecide,
  modelForTier,
  readOnlyTools,
} from '../state/settings.js'
import { decideTool } from '../runtime/tool-decision.js'
import { roleSettings } from '../runtime/role-settings.js'
import { runtime } from '../runtime/runtime-state.js'
import { notePending, noteResolved } from '../runtime/held-calls.js'
import { shellExecOf } from '../host-calls.js'
import type { CommandProposal } from '../profile/command-proposal.js'
import { inBackground } from '../background.js'
import { NOT_STARTED } from './intake-outcome.js'
import { NO_START_REASON } from '../runtime/start-failure.js'

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
  readonly progress: { done: boolean; architectSession: string | null; startFailure: string | null }
}

/** Where the architect works: its brief, its order's directory, and the lane checkout. */
type ArchitectPlace =
  | { ok: true; plan: ConvergeBrief; featureDir: string; checkout: Checkout }
  | { ok: false; reason: string }

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// One intake turn, in a session the operator can see, read-only in the order's lane
// checkout (ADR-061). It answers in structured output, validated before it reaches the order, and
// resolves once the architect is running, not when the minutes-long turn finishes.
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
    const progress: ArchitectLaunch['progress'] = {
      done: false,
      architectSession: null,
      startFailure: null,
    }
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

// Writes the conversation onto the order, so the Forge's "Attach" has a session.
// The turn's outcome waits for this load-and-save: one landing after the amendment
// put the old plan back, with the answered finding open again.
function rememberSessions(root: string, orderId: string): SessionMemory {
  let remembering: Promise<void> = Promise.resolve()
  let remembered: string | null = null
  const remember = (sessionId: string): void => {
    // A turn's start reports its session twice: as it registers, and when the start returns.
    if (sessionId === remembered) return
    remembered = sessionId
    intakeSessions.set(orderId, sessionId)
    announceLive(orderId)
    remembering = remembering
      .then(async () => {
        // Through `update`, which queues behind the intake state's own write to the order.
        await orderStoreAt(root).update(orderId, (current) => ({
          ...current,
          provenance: { ...current.provenance, forgeSession: sessionId },
        }))
      })
      .catch(() => {
        // A record of which conversation this was is a courtesy. Losing it
        // must not fail the intake it is describing.
      })
  }
  return { remember, remembered: () => remembering }
}

function launchArchitect(launch: ArchitectLaunch): void {
  const { turn, memory, answer, progress } = launch
  const { order } = turn
  inBackground(
    launch.runner
      .start(architectStartOptions(launch))
      .then(async (run) => {
        if (run === null) {
          await architectNotStarted(launch)
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
  )
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
    // Read-only, enforced by Claude's settings rather than by the prompt. The
    // architect proposes; it does not edit the repository it is reading.
    ...readOnlyTurn(api, { checkout, outputPath: null }),
    outputSchema: plan.outputSchema,
    onStructuredOutput: (answer) => receiveAnswer(launch, answer),
    // Intake is where questions belong, so one asked here is not a defect
    // — it is the Forge working.
    ...heldCallNotes(api, featureDir),
    onAutoDenied: (tool, reason) =>
      postRefusal(intakeSessions.get(order.id) ?? order.id, { tool, reason }),
    onRegistered: (run) => architectRegistered(launch, run.sessionId),
    onStartFailed: (reason) => void (launch.progress.startFailure = reason),
    onEnd: (exitCode) => architectEnded(launch, exitCode),
  }
}

function architectRegistered(launch: ArchitectLaunch, sessionId: string): void {
  launch.progress.architectSession = sessionId
  launch.memory.remember(sessionId)
  launch.answer({ ok: true, sessionId })
}

/** The one ledger line for an agent that could not start; nothing retries it. */
function recordNotStarted(
  store: OrderStore,
  { orderId, roleId, reason }: { orderId: string; roleId: string; reason: string }
): Promise<void> {
  return store.record({
    at: new Date().toISOString(),
    orderId,
    actor: `role:${roleId}`,
    action: NOT_STARTED,
    subject: orderId,
    reason,
    evidence: [],
  })
}

// Its own outcome, not a refused proposal: there was no proposal, and a retry would
// hit the same start failure. The start answer carries it; no turn outcome follows.
async function architectNotStarted(launch: ArchitectLaunch): Promise<void> {
  const { turn, progress } = launch
  const { order } = turn
  if (progress.done || deletedOrders.has(order.id)) return
  progress.done = true
  intakeSessions.delete(order.id)
  announceLive(order.id)
  const reason = progress.startFailure ?? NO_START_REASON
  await recordNotStarted(orderStoreAt(turn.root), {
    orderId: order.id,
    roleId: 'architect',
    reason,
  })
  launch.answer({ ok: false, notStarted: true, reason })
}

// One conversation per order, so a follow-up does not re-read the repository; the
// recorded one is the fallback once the in-memory map dies with a restart.
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

/** The mode, settings and fallback decision of a turn that reads and writes one file. */
function readOnlyTurn(
  api: ExtensionAPI,
  turn: { checkout: Checkout; outputPath: string | null }
): Pick<StartSupervisedRunOptions, 'mode' | 'settings' | 'autoDecide'> {
  const { permissionMode, settings } = roleSettings({
    readOnly: true,
    docsOnly: false,
    restrictedWrites: true,
    autonomy: autonomyFor(api),
    letModeDecide: letAutoModeDecide(api),
    outputPath: turn.outputPath,
    outputsDir: null,
    skillsMount: null,
    mayUseTool: () => true,
    probedCommands: [],
    readOnlyTools: readOnlyTools(api, turn.checkout.origin),
  })
  const autonomy = autonomyFor(api)
  return {
    mode: permissionMode,
    settings,
    autoDecide: (tool, input) =>
      decideTool({ tool, input, autonomy, outputsDir: null, readOnly: true }),
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

/** Why a session that ended without a proposal ended, in the operator's words. */
function endedReason(code: number | null): string {
  if (code === null) return 'The architect could not be started.'
  if (code !== 0) {
    return `The architect's terminal exited with code ${code} before it wrote a plan. Its tab is still open.`
  }
  return 'the architect wrote no proposal'
}

// The proposal arrives as the architect's structured answer. The turn ending is not
// the architect finishing, so only the answer (or the session ending) closes the turn.
function receiveAnswer(launch: ArchitectLaunch, answer: unknown): void {
  const { turn, progress } = launch
  if (progress.done || deletedOrders.has(turn.order.id)) return
  progress.done = true
  // The proposal is in, so the turn's terminal has nothing left to do. A
  // follow-up resumes the conversation in a fresh one.
  if (progress.architectSession !== null) launch.runner.stop(progress.architectSession)
  finishTurn(launch, applyArchitectAnswer(turn.order, answer, new Date().toISOString()))
}

// The session is over, so it must not be resumed: `--resume` on one the runtime has
// forgotten silently starts a fresh agent that believes it is continuing.
function architectEnded(launch: ArchitectLaunch, code: number | null): void {
  const { turn, progress } = launch
  if (progress.done || deletedOrders.has(turn.order.id)) return
  progress.done = true
  intakeSessions.delete(turn.order.id)
  announceLive(turn.order.id)
  finishTurn(launch, { ok: false, reason: endedReason(code) })
}

function finishTurn(launch: ArchitectLaunch, outcome: ConvergeResult): void {
  inBackground(launch.memory.remembered().then(() => launch.turn.onFinished(outcome)))
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
  /** Commands the round proposed for the checks. Not waited for: proving them takes a run each. */
  readonly onCommands?: (orderId: string, commands: readonly CommandProposal[]) => Promise<void>
  /** Stamped onto every fresh finding — only meaningful for the red team. */
  readonly round?: number
  /** Called once the round's session exists, before its turn ends; absent if unneeded. */
  readonly onStarted?: (sessionId: string) => void
  /** The role could not start; absent, `onFinished(null)` ends the round instead. */
  readonly onNotStarted?: (reason: string) => Promise<void>
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
  readonly progress: {
    done: boolean
    announced: boolean
    roundSession: string | null
    startFailure: string | null
  }
}

const freshRoundProgress = (): RoundLaunch['progress'] => ({
  done: false,
  announced: false,
  roundSession: null,
  startFailure: null,
})

// One read-only Forge round before agreement (the red team's attack or the scout's
// reading): the architect's mechanism, a lane-checkout session writing one file back.
// See docs/research/foundry-red-team-loop.md ("Design → Loop").
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
  const progress = freshRoundProgress()
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
  inBackground(
    recordRound(input, launch.store, {
      action: input.startedAction,
      reason: input.startedReason,
      subject,
    })
  )
  input.onStarted?.(subject)
}

function startRound(launch: RoundLaunch): void {
  const { input } = launch
  inBackground(
    launch.runner
      .start(roundStartOptions(launch))
      .then((run) => {
        if (run === null) {
          inBackground(roundNotStarted(launch))
          return
        }
        announceRound(launch, run.sessionId)
      })
      .catch((error: unknown) => {
        inBackground(
          recordRound(input, launch.store, {
            action: `${input.roleId}.refused`,
            reason: reasonOf(error),
            subject: input.order.id,
          })
        )
        inBackground(input.onFinished(null))
      })
  )
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
    // Read-only, enforced by Claude's settings rather than by the prompt, with the
    // one exception being the rung's own output file.
    ...readOnlyTurn(api, { checkout, outputPath: launch.outputPath }),
    ...heldCallNotes(api, featureDir),
    onAutoDenied: (tool, reason) => postRefusal(order.id, { tool, reason }),
    onRegistered: (run) => {
      launch.progress.roundSession = run.sessionId
      announceRound(launch, run.sessionId)
    },
    onStartFailed: (reason) => void (launch.progress.startFailure = reason),
    onTurnEnd: () => inBackground(collectRound(launch, false)),
    onEnd: () => inBackground(collectRound(launch, true)),
  }
}

// Not waited for: the scout is done when it has read, and proving a command takes a run.
// Nobody awaits it, so a failure to write the profile must not become an unhandled rejection.
function proposeCommands(input: ReadOnlyRound, commands: readonly CommandProposal[]): void {
  if (commands.length > 0) void input.onCommands?.(input.order.id, commands).catch(() => undefined)
}

async function roundNotStarted(launch: RoundLaunch): Promise<void> {
  const { input, store, progress } = launch
  if (progress.done || deletedOrders.has(input.order.id)) return
  progress.done = true
  const reason = progress.startFailure ?? NO_START_REASON
  await recordNotStarted(store, { orderId: input.order.id, roleId: input.roleId, reason })
  await (input.onNotStarted?.(reason) ?? input.onFinished(null))
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
  proposeCommands(input, result.commands)
  await input.onFinished(result.order, result.anotherPass)
}
