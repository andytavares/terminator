import type { ExtensionAPI } from '@terminator/extension-sdk'
import * as fs from 'node:fs'

import { rulesFor } from '../verify/rules.js'
import { ensureCheckout } from '../line/worktree.js'
import type { Checkout } from '../line/worktree.js'
import { issueOf, workspaceFor } from '../line/order-project.js'
import { resumableIn } from '../runtime/claude-launch.js'
import { architectModel, convergeBrief, readProposal } from './converge.js'
import type { ConvergeOutcome, ConvergeStarted } from '../ipc/forge-channels.js'
import type { Role } from '../recipe/parse.js'
import { collectableWrites, readRungOutput, rungOutputPath } from '../line/rung-output.js'
import { agentTitle } from '../runtime/agent-title.js'
import { resolveRole } from '../recipe/resolve.js'
import type { WorkOrder } from '../order/schema.js'
import { orderDir } from '../data-root.js'

import { resolveSources } from '../workspace-root.js'
import { announceLive, orderStoreAt } from '../state/live-index.js'
import { intakeSessions, deletedOrders } from './intake-sessions.js'
import { askModel, modelForTier } from '../state/settings.js'
import { trustRepository, readOnlyAutoDecide } from '../runtime/agent-policy.js'
import { runtime } from '../runtime/runtime-state.js'
import { notePending, noteResolved } from '../runtime/held-calls.js'

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
  root: string,
  order: WorkOrder,
  message: string,
  onFinished: (outcome: ConvergeOutcome) => Promise<void>,
  // A review-loop turn carries the red team's findings as `message`, but it is
  // the architect fixing its own plan, not an ask — so it stays on the draft
  // model rather than the ask model. See `architectModel`.
  options?: { readonly loop?: boolean }
): Promise<ConvergeStarted> {
  if (deletedOrders.has(order.id)) return { ok: false, reason: 'The order was deleted.' }
  const runner = runtime.supervisedRunner
  if (runner === null) {
    return { ok: false, reason: 'The supervision runtime is not running, so intake cannot start.' }
  }

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
      message,
    })
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }

  const featureDir = orderDir(root, order.id)
  await fs.promises.mkdir(featureDir, { recursive: true })

  // The lane's own checkout, so the order is one project from its first turn
  // (ADR-061) and the architect reads the base the builder will change.
  let checkout: Checkout
  try {
    checkout = await ensureCheckout(order, 1, { exec: (o) => api.shell.exec(o), root })
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }

  // One conversation per order, so a follow-up does not make the architect
  // read the repository again to answer "why not the other approach".
  //
  // The recorded one is the fallback: the in-memory map dies with the process,
  // and an order reopened after a restart should still know which conversation
  // produced it.
  const resuming = intakeSessions.get(order.id) ?? order.provenance.forgeSession ?? undefined

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
  let remembering: Promise<void> = Promise.resolve()
  const rememberSession = (sessionId: string): void => {
    intakeSessions.set(order.id, sessionId)
    announceLive(order.id)
    remembering = remembering
      .then(async () => {
        const current = await orderStoreAt(root).load(order.id)
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

  return new Promise<ConvergeStarted>((resolve) => {
    let answered = false
    const answer = (started: ConvergeStarted): void => {
      if (answered) return
      answered = true
      resolve(started)
    }
    let done = false
    let architectSession: string | null = null
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
    const collect = (deadline: boolean, code: number | null): void => {
      if (done || deletedOrders.has(order.id)) return
      if (!deadline && !fs.existsSync(plan.proposalPath)) return
      done = true
      // The proposal is in, so the turn's terminal has nothing left to do. A
      // follow-up resumes the conversation in a fresh one.
      if (!deadline && architectSession !== null) runner.stop(architectSession)
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
      void remembering.then(() => onFinished(outcome))
      answer({ ok: false, reason: 'The architect ended before it started.' })
    }

    trustRepository(api, plan.cwd, order.id, orderStoreAt(root))

    void runner
      .start({
        featureDir,
        worktreePath: checkout.path,
        workspaceId: workspaceFor(api.workspace?.list() ?? [], checkout.origin),
        branch: checkout.branch,
        issue: issueOf(order),
        title: 'Architect',
        prompt: plan.prompt,
        phase: 'architect' as never,
        resumeSessionId: plan.role.allowResume ? resumableIn(checkout.path, resuming) : undefined,
        model: architectModel(
          message,
          { draft: modelForTier(api, plan.role.modelTier), ask: askModel(api) },
          options
        ),
        // Read-only, enforced by the hook rather than by the prompt. The
        // architect proposes; it does not edit the repository it is reading.
        // Its one exception is the proposal itself, and only at that path.
        autoDecide: readOnlyAutoDecide(plan.proposalPath),
        // Intake is where questions belong, so one asked here is not a defect
        // — it is the Forge working.
        onPending: (pending) => notePending(api, { ...pending, featureDir }),
        onResolved: (requestId) => noteResolved(requestId),
        onAutoDenied: (tool, reason) =>
          runtime.supervision?.feed.post({
            at: Date.now(),
            sessionId: intakeSessions.get(order.id) ?? order.id,
            author: 'console',
            summary: `refused ${tool}: ${reason}`,
          }),
        onRegistered: (run) => {
          architectSession = run.sessionId
          rememberSession(run.sessionId)
          answer({ ok: true, sessionId: run.sessionId })
        },
        onTurnEnd: () => collect(false, 0),
        onEnd: (exitCode) => collect(true, exitCode),
      })
      .then((run) => {
        if (run === null) {
          collect(true, null)
          return
        }
        rememberSession(run.sessionId)
        answer({ ok: true, sessionId: run.sessionId })
      })
      .catch((error: unknown) => {
        done = true
        intakeSessions.delete(order.id)
        announceLive(order.id)
        answer({
          ok: false,
          reason: error instanceof Error ? error.message : 'The architect could not be started.',
        })
      })
  })
}

/**
 * One read-only round in the Forge, before the order is agreed: the red
 * team's attack, or the scout's reconnaissance.
 *
 * The same mechanism as the architect's own turn — a session in the lane
 * checkout that writes one file back — reused for the two roles that only
 * ever read. See docs/research/foundry-red-team-loop.md ("Design → Loop").
 */
export async function readOnlyRound(input: {
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
}): Promise<void> {
  const { api, root, order, roleId, nodeId, startedAction, startedReason, onFinished } = input
  if (deletedOrders.has(order.id)) return
  const runner = runtime.supervisedRunner
  const store = orderStoreAt(root)
  const record = (action: string, reason: string, subject: string): Promise<void> =>
    store.record({
      at: new Date().toISOString(),
      orderId: order.id,
      actor: `role:${roleId}`,
      action,
      subject,
      reason,
      evidence: [],
    })

  if (runner === null) {
    await record(`${roleId}.refused`, 'the supervision runtime is not running', order.id)
    await onFinished(null)
    return
  }

  const sources = resolveSources(api, root)
  const resolved = resolveRole(roleId, sources)
  if (!resolved.ok) {
    await record(`${roleId}.refused`, resolved.reason, order.id)
    await onFinished(null)
    return
  }
  const role = resolved.resolved.value
  const featureDir = orderDir(root, order.id)
  const outputPath = rungOutputPath(featureDir, nodeId)

  let checkout: Checkout
  try {
    checkout = await ensureCheckout(order, 1, { exec: (o) => api.shell.exec(o), root })
  } catch (error) {
    await record(
      `${roleId}.refused`,
      error instanceof Error ? error.message : String(error),
      order.id
    )
    await onFinished(null)
    return
  }

  trustRepository(api, checkout.path, order.id, store)

  let done = false
  let announced = false
  let roundSession: string | null = null
  const announce = (subject: string): void => {
    if (announced) return
    announced = true
    void record(startedAction, startedReason, subject)
    input.onStarted?.(subject)
  }

  const collect = async (deadline: boolean): Promise<void> => {
    if (done || deletedOrders.has(order.id)) return
    if (!deadline && !fs.existsSync(outputPath)) return
    done = true
    // Read-only and one turn: once its file is in, the round is over.
    if (!deadline && roundSession !== null) runner.stop(roundSession)
    const current = (await store.load(order.id)) ?? order
    const result = readRungOutput({
      order: current,
      role: roleId,
      writes: collectableWrites(role),
      outputPath,
      at: new Date().toISOString(),
      round: input.round,
    })
    if (result === null) {
      await record(`${roleId}.refused`, `the ${roleId} wrote nothing`, order.id)
      await onFinished(null)
      return
    }
    if (!result.ok) {
      await record(`${roleId}.refused`, result.reason, order.id)
      await onFinished(null)
      return
    }
    await store.save(result.order)
    await onFinished(result.order, result.anotherPass)
  }

  void runner
    .start({
      featureDir,
      worktreePath: checkout.path,
      workspaceId: workspaceFor(api.workspace?.list() ?? [], checkout.origin),
      branch: checkout.branch,
      issue: issueOf(order),
      title: agentTitle(roleId),
      prompt: input.prompt(role),
      phase: roleId,
      model: input.model ?? modelForTier(api, role.modelTier),
      // Read-only, enforced by the hook rather than by the prompt, with the
      // one exception being the rung's own output file.
      autoDecide: readOnlyAutoDecide(outputPath),
      onPending: (pending) => notePending(api, { ...pending, featureDir }),
      onResolved: (requestId) => noteResolved(requestId),
      onAutoDenied: (tool, reason) =>
        runtime.supervision?.feed.post({
          at: Date.now(),
          sessionId: order.id,
          author: 'console',
          summary: `refused ${tool}: ${reason}`,
        }),
      onRegistered: (run) => {
        roundSession = run.sessionId
        announce(run.sessionId)
      },
      onTurnEnd: () => void collect(false),
      onEnd: () => void collect(true),
    })
    .then((run) => {
      if (run === null) {
        void collect(true)
        return
      }
      announce(run.sessionId)
    })
    .catch((error: unknown) => {
      void record(
        `${roleId}.refused`,
        error instanceof Error ? error.message : String(error),
        order.id
      )
      void onFinished(null)
    })
}
