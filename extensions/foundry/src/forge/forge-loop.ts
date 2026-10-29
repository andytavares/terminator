import type { ExtensionAPI } from '@terminator/extension-sdk'

import { rulesFor } from '../verify/rules.js'
import { followUpFor, retryForRefusal, REWRITING_UNREADABLE } from './autonomy.js'
import {
  anotherPassWanted,
  loopFacts,
  currentIntake,
  reviewedCurrentPlan,
} from './intake-outcome.js'
import { readyToHandOff } from './release-again.js'
import type { ReleaseDeps, Step } from './release-again.js'
import { compileOrder } from '../order/compile.js'
import {
  convergeMaybeScouted as scoutedConverge,
  waitForScout,
  withScoutContext,
} from './scouted-converge.js'
import type { ConvergeOutcome, ConvergeStarted } from '../ipc/forge-channels.js'
import { rungOutputPath } from '../line/rung-output.js'
import { baselineDepsFor } from '../line/baseline-deps.js'
import { proveScoutCommands } from '../line/scout-commands.js'
import {
  MAX_REVIEW_ROUNDS,
  reviewPrompt,
  reviewNext,
  afterFix,
  shouldReview,
  nextRound,
  afterRelease,
  reviewSkipReason,
  lighterRedTeamModel,
} from './review-loop.js'
import type { ReleaseNext } from './review-loop.js'
import { brief } from '../line/brief.js'
import type { WorkOrder } from '../order/schema.js'
import { isBlocking } from '../order/schema.js'
import type { Role } from '../recipe/parse.js'
import { orderDir } from '../data-root.js'

import type { ForgeChannels } from '../ipc/forge-channels.js'
import type { RunChannels } from '../ipc/run-channels.js'
import type { ActivationContext } from '../ipc/register.js'
import { resolveSources } from '../workspace-root.js'
import { orderStoreAt } from '../state/live-index.js'
import { intakeAt, setIntake } from './intake-state.js'
import { intakeSessions } from './intake-sessions.js'
import { lighterRedTeam, defaultModel } from '../state/settings.js'
import { endLiveSession, isLiveSession } from '../runtime/runtime-state.js'
import { convergeOnce, readOnlyRound } from './intake-turn.js'
import type { Deciding } from '../ipc/standing.js'
import { plural } from '@terminator/extension-sdk'
import { inBackground } from '../background.js'

/** What the loop needs that is built after it: the channels an order is agreed and started through. */
export interface ForgeLoopDeps {
  readonly deciding: Deciding
  readonly channels: () => { readonly forge: ForgeChannels; readonly runs: RunChannels }
}

/** The Forge's turns, reviews and hand-offs, entered from a channel or a decision. */
export interface ForgeLoop {
  readonly convergeWithFollowUps: (ask: ArchitectAsk) => Promise<ConvergeStarted>
  readonly convergeMaybeScouted: (
    order: WorkOrder,
    message: string,
    recordStart?: RecordStart
  ) => Promise<ConvergeStarted>
  readonly onReleased: (order: WorkOrder) => void
}

/** Everything the loop's steps share: the host, the data root, and the loop's own deps. */
interface Forge extends ForgeLoopDeps {
  readonly api: ExtensionAPI
  readonly dataRoot: () => string
}

/** One architect turn the loop asked for, and where in the loop it sits. */
interface ArchitectAsk {
  readonly order: WorkOrder
  readonly message: string
  readonly autoTurns: number
  // Set only for a turn the review loop started to fix its own findings: its round,
  // which keeps the turn on the draft model (`architectModel`). Undefined starts a
  // fresh chain, so the next review the redraft earns is round 1.
  readonly loopRound?: number
  /** Writes the turn's start to the ledger; see `convergeWithFollowUps`. */
  readonly recordStart?: RecordStart
}

/** Writes the ledger line that says an architect turn started, or could not. */
type RecordStart = (started: ConvergeStarted) => Promise<void>

/** One red-team round: the order it attacks, which round, and what changed since the last. */
interface Review {
  readonly order: WorkOrder
  readonly round: number
  readonly changed: string
}

/** A review under way, and the data root it was started against. */
interface ReviewAt extends Review {
  readonly root: string
}

/** One line on an order's ledger, written by the loop. */
interface LoopEntry {
  readonly orderId: string
  readonly actor: string
  readonly action: string
  readonly subject: string
  readonly reason: string
}

/** The Forge's loop: an architect turn, its follow-ups, red-team rounds, the hand-off. */
export function createForgeLoop(
  { api, dataRoot }: ActivationContext,
  { deciding, channels }: ForgeLoopDeps
): ForgeLoop {
  const forge: Forge = { api, dataRoot, deciding, channels }
  return {
    convergeWithFollowUps: (ask) => convergeWithFollowUps(forge, ask),
    convergeMaybeScouted: (order, message, recordStart) =>
      convergeForForge(forge, { order, message, recordStart }),
    onReleased: (order) => inBackground(resumeAfterRelease(forge, order)),
  }
}

async function recordLoopEntry(root: string, entry: LoopEntry): Promise<void> {
  await orderStoreAt(root).record({ at: new Date().toISOString(), ...entry, evidence: [] })
}

const nextReviewRound = async (forge: Forge, orderId: string): Promise<number> =>
  nextRound(loopFacts(await orderStoreAt(forge.dataRoot()).entries(orderId)))

// One architect turn and the ones the Forge starts after it: a plan still failing a
// check the architect can close goes back up to MAX_AUTO_TURNS times (spec 062).
// Only open questions, or a plan failing when the turns run out, reach the operator.
async function convergeWithFollowUps(forge: Forge, ask: ArchitectAsk): Promise<ConvergeStarted> {
  const { order } = ask
  // The turn's end waits for its start to be on the ledger, which decides what comes
  // next: a start written late reads as an architect still running, or goes
  // missing from the follow-up count.
  let startWritten = (): void => undefined
  const written = new Promise<void>((resolve) => {
    startWritten = resolve
  })
  try {
    const started = await convergeOnce(forge.api, {
      root: forge.dataRoot(),
      order,
      message: ask.message,
      loop: ask.loopRound !== undefined,
      onFinished: async (outcome) => {
        await written
        await forge.deciding.during(order.id, () => afterArchitectTurn(forge, ask, outcome))
      },
    })
    if (!started.ok && started.notStarted) sayNotStarted(forge.api, order, started.reason)
    else await ask.recordStart?.(started)
    await setIntake(forge.dataRoot(), order.id, startedIntake(ask, started))
    return started
  } finally {
    startWritten()
  }
}

// A follow-up or a fix turn is `fixing`; the operator's ask and the first draft are `drafting`.
function startedIntake(
  ask: ArchitectAsk,
  started: ConvergeStarted
): Parameters<typeof setIntake>[2] {
  if (!started.ok) return { state: 'failed', reason: started.reason }
  const fixing = ask.autoTurns > 0 || ask.loopRound !== undefined
  return { state: fixing ? 'fixing' : 'drafting' }
}

async function continueAutomatically(
  forge: Forge,
  ask: ArchitectAsk,
  next: { from: WorkOrder; message: string; why: string }
): Promise<void> {
  const { order } = ask
  const root = forge.dataRoot()
  await endPreviousTurn(order.id)
  await convergeWithFollowUps(forge, {
    order: next.from,
    message: next.message,
    autoTurns: ask.autoTurns + 1,
    loopRound: ask.loopRound,
    recordStart: (started) =>
      recordLoopEntry(root, {
        orderId: order.id,
        actor: 'role:architect',
        action: started.ok ? 'converge.followed_up' : 'converge.refused',
        subject: started.ok ? started.sessionId : order.id,
        reason: started.ok ? next.why : started.reason,
      }),
  })
}

// The finished turn's process is still at its prompt; the follow-up
// resumes the same conversation, so end it first.
async function endPreviousTurn(orderId: string): Promise<void> {
  const previous = intakeSessions.get(orderId)
  if (previous === undefined) return
  await endLiveSession(previous, 'continuing in a follow-up turn')
}

async function afterArchitectTurn(
  forge: Forge,
  ask: ArchitectAsk,
  outcome: ConvergeOutcome
): Promise<void> {
  const root = forge.dataRoot()
  if (!outcome.ok) {
    await afterRefusedProposal(forge, ask, { root, reason: outcome.reason })
    return
  }
  await afterRedraft(forge, ask, { root, outcome })
}

async function afterRefusedProposal(
  forge: Forge,
  ask: ArchitectAsk,
  { root, reason }: { root: string; reason: string }
): Promise<void> {
  const { order } = ask
  const store = orderStoreAt(root)
  await recordLoopEntry(root, {
    orderId: order.id,
    actor: 'role:architect',
    action: 'converge.refused',
    subject: order.id,
    reason,
  })
  await setIntake(root, order.id, { state: 'failed', reason })
  // A proposal in the wrong shape is the architect's to fix, from the
  // field paths it can read and the operator cannot.
  const retry =
    loopFacts(await store.entries(order.id)).heldAt === null
      ? retryForRefusal(reason, ask.autoTurns)
      : null
  if (retry !== null) {
    await continueAutomatically(forge, ask, {
      from: order,
      message: retry,
      why: REWRITING_UNREADABLE,
    })
    return
  }
  sayPlanRefused(forge.api, order)
}

function sayNotStarted(api: ExtensionAPI, order: WorkOrder, reason: string): void {
  api.notifications.showToast(
    'warning',
    `${order.title}: Claude could not start the architect: ${reason}`,
    `foundry.converge.not-started.${order.id}`
  )
}

// Said once, out loud: a refusal changes nothing, so nothing the operator is looking
// at shows it until they reopen the order.
function sayPlanRefused(api: ExtensionAPI, order: WorkOrder): void {
  api.notifications.showToast(
    'warning',
    `${order.title}: the architect's plan was refused and nothing changed.`,
    `foundry.converge.refused.${order.id}`
  )
}

async function afterRedraft(
  forge: Forge,
  ask: ArchitectAsk,
  { root, outcome }: { root: string; outcome: Extract<ConvergeOutcome, { ok: true }> }
): Promise<void> {
  const { order } = ask
  const store = orderStoreAt(root)
  // The scout runs beside a first draft, so it may have stored its
  // findings while this turn was still writing.
  const drafted = withScoutContext(outcome.order, await store.load(order.id))
  await store.save({ ...drafted, intake: intakeAt('ready', new Date()) })
  await recordLoopEntry(root, {
    orderId: order.id,
    actor: 'role:architect',
    action: 'order.redrafted',
    subject: order.id,
    reason: outcome.note === '' ? 'redrafted the plan' : outcome.note,
  })

  // The operator's "Hold for me" stops every automatic continuation,
  // this one included — a redraft that just landed still saves, but
  // nothing starts on its own from here until the operator releases it.
  if (loopFacts(await store.entries(order.id)).heldAt !== null) return

  const next = followUpFor(compileOrder(drafted).failures, ask.autoTurns)
  if (next === null) {
    await reviewOrHandOff(forge, ask, { root, order: drafted, changed: outcome.note })
    return
  }
  const why = 'closing the failing checks on its own'
  await continueAutomatically(forge, ask, { from: drafted, message: next, why })
}

// Nothing left the architect can close on its own by compiling again.
// If the order is otherwise ready, the red team gets a round before
// the operator ever sees it — the whole point of the loop.
async function reviewOrHandOff(
  forge: Forge,
  ask: ArchitectAsk,
  { root, order: drafted, changed }: { root: string; order: WorkOrder; changed: string }
): Promise<void> {
  if (!shouldReview(drafted)) return
  const store = orderStoreAt(root)
  // A fix turn is ready for hand-off unless the red team asked to see the fix.
  if (
    ask.loopRound !== undefined &&
    afterFix({
      order: drafted,
      anotherPass: anotherPassWanted(await store.entries(ask.order.id)),
    }) === 'hand-off'
  ) {
    await handOffWhenReady(forge, drafted)
    return
  }
  const round = ask.loopRound ?? (await nextReviewRound(forge, ask.order.id))
  await startReviewRound(forge, { order: drafted, round, changed })
}

// One red-team round and what follows: `fix` sends the open blocking findings back as
// one architect turn on the loop's tier, `operator` gives up after MAX_REVIEW_ROUNDS
// (the one point that reaches the operator), `clean` hands the order off.
async function startReviewRound(forge: Forge, review: Review): Promise<void> {
  const { api } = forge
  const { order, round } = review
  const root = forge.dataRoot()
  const skipReason = round === 1 ? reviewSkipReason(order) : null
  if (skipReason !== null) {
    await skipReview(forge, { root, order, reason: skipReason })
    return
  }
  // The scout runs beside the first draft, so what it found reaches the red
  // team from the store rather than from the draft it is attacking.
  await waitForScout(order.id)
  const attacked = withScoutContext(order, (await orderStoreAt(root).load(order.id)) ?? null)
  await setIntake(root, order.id, { state: 'reviewing' })
  await readOnlyRound({
    api,
    root,
    order,
    roleId: 'red-team',
    nodeId: `review-${round}`,
    round,
    model: lighterRedTeam(api) ? lighterRedTeamModel(defaultModel(api)) : undefined,
    prompt: (role) => reviewPromptFor(api, { ...review, root }, { role, attacked }),
    startedAction: 'review.started',
    startedReason: `round ${round}`,
    ...reviewEnds(forge, { ...review, root }),
  })
}

/** How a red-team round ends: with its findings, or because Claude could not start it. */
function reviewEnds(
  forge: Forge,
  review: ReviewAt
): Pick<Parameters<typeof readOnlyRound>[0], 'onFinished' | 'onNotStarted'> {
  const { root, order } = review
  return {
    onFinished: (updated, anotherPass) =>
      forge.deciding.during(order.id, () => afterRound(forge, review, { updated, anotherPass })),
    onNotStarted: (reason) =>
      forge.deciding.during(order.id, () =>
        setIntake(root, order.id, {
          state: 'failed',
          reason: `Claude could not start the red team: ${reason}`,
        })
      ),
  }
}

// A refusal was already recorded by readOnlyRound, where the standing reads it; the
// intake state is what says the round is over.
async function afterRound(
  forge: Forge,
  review: ReviewAt,
  { updated, anotherPass }: { updated: WorkOrder | null; anotherPass: boolean | undefined }
): Promise<void> {
  if (updated === null) {
    await setIntake(review.root, review.order.id, {
      state: 'failed',
      reason: 'The red team did not answer.',
    })
    return
  }
  await afterReviewRound(forge, { ...review, order: updated }, anotherPass)
}

// Recorded rather than silent: the Forge reads this as the red team
// step passed, with the reason, instead of a step still owed.
async function skipReview(
  forge: Forge,
  { root, order, reason }: { root: string; order: WorkOrder; reason: string }
): Promise<void> {
  await recordLoopEntry(root, {
    orderId: order.id,
    actor: 'rule:forge',
    action: 'review.skipped',
    subject: order.id,
    reason,
  })
  await handOffWhenReady(forge, order)
}

function reviewPromptFor(
  api: ExtensionAPI,
  review: ReviewAt,
  { role, attacked }: { role: Role; attacked: WorkOrder }
): string {
  const { root, order, round } = review
  return reviewPrompt({
    order: attacked,
    role,
    rules: houseRulesAt(api, root, order),
    outputPath: rungOutputPath(orderDir(root, order.id), `review-${round}`),
    round,
    changed: review.changed,
  })
}

async function afterReviewRound(
  forge: Forge,
  review: ReviewAt,
  anotherPass: boolean | undefined
): Promise<void> {
  const { root, order: updated, round } = review
  await recordReviewRound(root, review, anotherPass)
  await setIntake(root, updated.id, { state: 'ready' })

  // The operator's hold stops every automatic continuation this round
  // could lead to — the next round, "ready", or a fix turn — the same
  // as it stops a redraft's own follow-up.
  if (loopFacts(await orderStoreAt(root).entries(updated.id)).heldAt !== null) return

  const next = reviewNext({ order: updated, round })
  if (next.kind === 'clean') {
    await handOffWhenReady(forge, updated)
    return
  }
  if (next.kind === 'operator') {
    await reviewExhausted(forge, review)
    return
  }
  await startFixTurn(forge, review, next.message)
}

async function recordReviewRound(
  root: string,
  { order: updated, round }: Review,
  anotherPass: boolean | undefined
): Promise<void> {
  // Only what is still open: a finding the architect already fixed or
  // the operator already accepted this same round is not what the
  // operator needs counted as still standing.
  const fresh = updated.redTeam.filter((f) => f.round === round && f.status === 'open')
  const blocking = fresh.filter(isBlocking).length
  const notes = fresh.length - blocking
  const entry = { orderId: updated.id, actor: 'role:red-team', subject: updated.id }
  await recordLoopEntry(root, {
    ...entry,
    action: 'review.round',
    reason: `round ${round}: ${blocking} blocking, ${notes} ${plural(notes, 'note', 'notes')}`,
  })
  if (anotherPass === true) {
    await recordLoopEntry(root, {
      ...entry,
      action: 'review.another_pass',
      reason: `round ${round} asked to review the fix`,
    })
  }
}

async function reviewExhausted(forge: Forge, { root, order: updated }: ReviewAt): Promise<void> {
  const stillOpen = updated.redTeam.filter((f) => f.status === 'open' && isBlocking(f)).length
  const findings = `${stillOpen} blocking ${plural(stillOpen, 'finding', 'findings')}`
  await recordLoopEntry(root, {
    orderId: updated.id,
    actor: 'role:red-team',
    action: 'review.exhausted',
    subject: updated.id,
    reason: `still has ${findings} after ${MAX_REVIEW_ROUNDS} rounds`,
  })
  forge.api.notifications.showToast(
    'warning',
    `${updated.title}: the red team still has ${findings} after ${MAX_REVIEW_ROUNDS} rounds — it needs you.`,
    `foundry.review.exhausted.${updated.id}`
  )
}

// Recorded here: the fix turn is `converge.started`, not `review.started`, and left
// to `convergeWithFollowUps` nothing recorded it, so the Forge saw no turn running.
async function startFixTurn(forge: Forge, review: ReviewAt, message: string): Promise<void> {
  const { root, order: updated, round } = review
  await convergeWithFollowUps(forge, {
    order: updated,
    message,
    autoTurns: 0,
    loopRound: round + 1,
    recordStart: (started) =>
      recordLoopEntry(root, {
        orderId: updated.id,
        actor: 'role:architect',
        action: started.ok ? 'converge.started' : 'converge.refused',
        subject: started.ok ? started.sessionId : updated.id,
        reason: started.ok ? `red team round ${round} fix` : started.reason,
      }),
  })
}

// A draft that passes every check. One never released waits for Hand off; one a
// defect sent back after release is agreed again and restarted (release-again.ts).
async function handOffWhenReady(forge: Forge, order: WorkOrder): Promise<void> {
  await readyToHandOff(order, releaseDepsFor(forge))
}

function releaseDepsFor(forge: Forge): ReleaseDeps {
  const { api } = forge
  const root = forge.dataRoot()
  const store = orderStoreAt(root)
  return {
    entries: (orderId) => store.entries(orderId),
    agree: (o) => agreeShapedOrder(forge, o),
    start: (o) => startOrder(forge, o),
    refuse: (o, reason) => refuseRestart({ api, root }, { order: o, reason }),
    sayReady: (o) =>
      api.notifications.showToast(
        'info',
        `${o.title} is ready to hand off.`,
        `foundry.review.ready.${o.id}`
      ),
    sayRestarted: (o) =>
      api.notifications.showToast(
        'info',
        `${o.title} was amended and is running again.`,
        `foundry.release.restarted.${o.id}`
      ),
  }
}

async function agreeShapedOrder(forge: Forge, o: WorkOrder): Promise<Step> {
  const r = (await forge.channels().forge.compile({ id: o.id, commit: true, automatic: true })) as {
    error?: string
    refused?: string
    order?: WorkOrder
    compile?: { failures: { detail: string }[] }
  }
  if (r.order?.status === 'agreed') return { ok: true }
  return {
    ok: false,
    reason:
      r.error ?? r.refused ?? r.compile?.failures[0]?.detail ?? 'the order could not be agreed',
  }
}

async function startOrder(forge: Forge, o: WorkOrder): Promise<Step> {
  const r = (await forge.channels().runs.start({
    id: o.id,
    ...(o.recipeOverriddenBy === 'operator' && o.recipe !== null ? { recipe: o.recipe } : {}),
  })) as { error?: string; started?: boolean; reason?: string }
  if (r.error !== undefined) return { ok: false, reason: r.error }
  if (r.started === false) return { ok: false, reason: r.reason ?? 'nothing started the run' }
  return { ok: true }
}

async function refuseRestart(
  { api, root }: { api: ExtensionAPI; root: string },
  { order: o, reason }: { order: WorkOrder; reason: string }
): Promise<void> {
  await recordLoopEntry(root, {
    orderId: o.id,
    actor: 'rule:forge',
    action: 'run.refused',
    subject: o.id,
    reason,
  })
  api.notifications.showToast(
    'warning',
    `${o.title} did not restart: ${reason}`,
    `foundry.release.refused.${o.id}`
  )
}

// Releasing a hold makes the move a finished turn would have made. A draft only, and
// only with nothing running: a hold over a running turn is released by that turn's
// own `onFinished`, and starting a second thing here would race it.
async function resumeAfterRelease(forge: Forge, order: WorkOrder): Promise<void> {
  if (order.status !== 'draft') return
  const root = forge.dataRoot()
  const entries = await orderStoreAt(root).entries(order.id)
  const { intake } = (await orderStoreAt(root).load(order.id)) ?? order
  if (currentIntake(entries, intake, { now: Date.now(), isLive: isLiveSession }).kind === 'running')
    return

  const next = afterRelease(order, {
    loop: loopFacts(entries),
    reviewedCurrentPlan: reviewedCurrentPlan(entries),
  })
  if (next.kind === 'review') {
    await startReviewRound(forge, { order, round: next.round, changed: '' })
  } else if (next.kind === 'hand-off') {
    await handOffWhenReady(forge, order)
  } else if (next.kind === 'fix' || next.kind === 'follow-up') {
    await convergeAfterRelease(forge, { root, order }, next)
  }
}

async function convergeAfterRelease(
  forge: Forge,
  { root, order }: { root: string; order: WorkOrder },
  next: Extract<ReleaseNext, { kind: 'fix' | 'follow-up' }>
): Promise<void> {
  const fix = next.kind === 'fix' ? next : null
  const startedAction = fix !== null ? 'converge.started' : 'converge.followed_up'
  const startedReason =
    fix !== null ? `red team round ${fix.round} fix` : 'closing the failing checks on its own'
  await convergeWithFollowUps(forge, {
    order,
    message: next.message,
    autoTurns: fix !== null ? 0 : 1,
    loopRound: fix !== null ? fix.round + 1 : undefined,
    recordStart: (started) =>
      recordLoopEntry(root, {
        orderId: order.id,
        actor: 'role:architect',
        action: started.ok ? startedAction : 'converge.refused',
        subject: started.ok ? started.sessionId : order.id,
        reason: started.ok ? startedReason : started.reason,
      }),
  })
}

// A first draft only (no applied decisions, no entry points): the scout reads the
// repository beside it and the architect does not wait (ADR 084). The orchestration
// is `forge/scouted-converge.ts`; this is the wiring.
function convergeForForge(
  forge: Forge,
  { order, message, recordStart }: Pick<ArchitectAsk, 'order' | 'message' | 'recordStart'>
): Promise<ConvergeStarted> {
  const root = forge.dataRoot()
  return scoutedConverge(
    {
      startScout: (scoutOrder) => startScout(forge, root, scoutOrder),
      startArchitect: (architectOrder, architectMessage) =>
        convergeWithFollowUps(forge, {
          order: architectOrder,
          message: architectMessage,
          autoTurns: 0,
          recordStart,
        }),
    },
    order,
    message
  )
}

/** What the scout is told: the order, read beside the first draft, written to its own output. */
function scoutBrief(
  forge: Forge,
  root: string,
  { order, role }: { order: WorkOrder; role: Parameters<typeof brief>[0]['role'] }
): string {
  const outputPath = rungOutputPath(orderDir(root, order.id), 'forge-scout')
  const rules = houseRulesAt(forge.api, root, order)
  return brief({ order, role, units: [], rules, outputPath })
}

// Settles when the scout's turn ends, so a red team that would start
// meanwhile can wait for what it found.
function startScout(forge: Forge, root: string, scoutOrder: WorkOrder): Promise<void> {
  return new Promise<void>((settled) => {
    inBackground(
      readOnlyRound({
        api: forge.api,
        root,
        order: scoutOrder,
        roleId: 'scout',
        nodeId: 'forge-scout',
        prompt: (role) => scoutBrief(forge, root, { order: scoutOrder, role }),
        onCommands: (orderId, commands) => {
          const store = orderStoreAt(root)
          const base = baselineDepsFor(forge.api, root, store)
          return proveScoutCommands(orderId, commands, { base, store })
        },
        startedAction: 'scout.started',
        startedReason: 'reading the repository beside the first draft',
        onFinished: async (updated) => {
          // A failure or an empty write was already recorded as
          // `scout.refused`; the architect never waited on it.
          if (updated !== null) await recordScoutCollected(root, updated)
          settled()
        },
      }).catch(settled)
    )
  })
}

function houseRulesAt(
  api: ExtensionAPI,
  root: string,
  order: WorkOrder
): ReturnType<typeof rulesFor>['rules'] {
  const sources = resolveSources(api, root)
  return rulesFor(sources, {
    repoPaths: sources.repoPaths,
    houseDocs: [...order.context.houseDocs],
  }).rules
}

async function recordScoutCollected(root: string, updated: WorkOrder): Promise<void> {
  const found = updated.context.entryPoints.length
  await recordLoopEntry(root, {
    orderId: updated.id,
    actor: 'role:scout',
    action: 'scout.collected',
    subject: updated.id,
    reason: `found ${found} ${plural(found, 'entry point', 'entry points')}`,
  })
}
