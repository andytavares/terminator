import { rulesFor } from '../verify/rules.js'
import { followUpFor, retryForRefusal, REWRITING_UNREADABLE } from './autonomy.js'
import { anotherPassWanted, loopFacts, lastIntake, reviewedCurrentPlan } from './intake-outcome.js'
import { readyToHandOff } from './release-again.js'
import { endAndWait } from '../runtime/end-session.js'
import { compileOrder } from '../order/compile.js'
import {
  convergeMaybeScouted as scoutedConverge,
  waitForScout,
  withScoutContext,
} from './scouted-converge.js'
import type { ConvergeStarted } from '../ipc/forge-channels.js'
import { rungOutputPath } from '../line/rung-output.js'
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
import { brief } from '../line/brief.js'
import type { WorkOrder } from '../order/schema.js'
import { isBlocking } from '../order/schema.js'
import { orderDir } from '../data-root.js'

import type { ForgeChannels } from '../ipc/forge-channels.js'
import type { RunChannels } from '../ipc/run-channels.js'
import type { ActivationContext } from '../ipc/register.js'
import { resolveSources } from '../workspace-root.js'
import { orderStoreAt } from '../state/live-index.js'
import { intakeSessions } from './intake-sessions.js'
import { lighterRedTeam, defaultModel } from '../state/settings.js'
import { runtime, isLiveSession } from '../runtime/runtime-state.js'
import { convergeOnce, readOnlyRound } from './intake-turn.js'
import type { Deciding } from '../ipc/standing.js'

/** What the loop needs that is built after it: the channels an order is agreed and started through. */
export interface ForgeLoopDeps {
  readonly deciding: Deciding
  readonly channels: () => { readonly forge: ForgeChannels; readonly runs: RunChannels }
}

/** The Forge's turns, reviews and hand-offs, entered from a channel or a decision. */
export interface ForgeLoop {
  readonly convergeWithFollowUps: (
    order: WorkOrder,
    message: string,
    autoTurns: number,
    loopRound?: number
  ) => Promise<ConvergeStarted>
  readonly convergeMaybeScouted: (order: WorkOrder, message: string) => Promise<ConvergeStarted>
  readonly onReleased: (order: WorkOrder) => void
}

/**
 * The Forge's own loop: an architect turn, the follow-ups it earns, the red
 * team's rounds, and the hand-off once nothing is left to close.
 */
export function createForgeLoop(
  { api, dataRoot }: ActivationContext,
  { deciding, channels }: ForgeLoopDeps
): ForgeLoop {
  const nextReviewRound = async (orderId: string): Promise<number> =>
    nextRound(loopFacts(await orderStoreAt(dataRoot()).entries(orderId)))

  /**
   * One architect turn, and the ones the Forge starts on its own after it.
   *
   * A plan that still fails a check the architect can close goes straight
   * back to it, up to MAX_AUTO_TURNS times, instead of waiting for someone to
   * click "Ask for the gap to be closed" (spec 062). Only unanswered questions,
   * or a plan still failing when the turns run out, reach the operator.
   */
  const convergeWithFollowUps = (
    order: WorkOrder,
    message: string,
    autoTurns: number,
    // Set only for a turn the review loop started to fix its own findings —
    // it names which round of that loop this is, and it is what keeps this
    // turn on the draft model rather than the ask model (`architectModel`).
    // Undefined for every operator- or auto-turn-started call, which is a
    // fresh chain: the next review the redraft earns starts at round 1.
    loopRound?: number
  ): Promise<ConvergeStarted> => {
    const continueAutomatically = async (
      from: WorkOrder,
      next: string,
      why: string
    ): Promise<void> => {
      const store = orderStoreAt(dataRoot())
      // The finished turn's process is still at its prompt; the follow-up
      // resumes the same conversation, so end it first.
      const previous = intakeSessions.get(order.id)
      if (previous !== undefined) {
        await endAndWait(
          {
            stop: (id, reason) => runtime.supervisedRunner?.stop(id, reason) ?? false,
            isLive: isLiveSession,
          },
          previous,
          'continuing in a follow-up turn'
        )
      }
      const started = await convergeWithFollowUps(from, next, autoTurns + 1, loopRound)
      await store.record({
        at: new Date().toISOString(),
        orderId: order.id,
        actor: 'role:architect',
        action: started.ok ? 'converge.followed_up' : 'converge.refused',
        subject: started.ok ? started.sessionId : order.id,
        reason: started.ok ? why : started.reason,
        evidence: [],
      })
    }

    return convergeOnce(
      api,
      dataRoot(),
      order,
      message,
      (outcome) =>
        deciding.during(order.id, async () => {
          const store = orderStoreAt(dataRoot())
          if (!outcome.ok) {
            await store.record({
              at: new Date().toISOString(),
              orderId: order.id,
              actor: 'role:architect',
              action: 'converge.refused',
              subject: order.id,
              reason: outcome.reason,
              evidence: [],
            })
            // A proposal in the wrong shape is the architect's to fix, from the
            // field paths it can read and the operator cannot.
            const retry =
              loopFacts(await store.entries(order.id)).heldAt === null
                ? retryForRefusal(outcome.reason, autoTurns)
                : null
            if (retry !== null) {
              await continueAutomatically(order, retry, REWRITING_UNREADABLE)
              return
            }
            // Out loud, once, because a refusal changes nothing and therefore
            // shows up nowhere the operator happens to be looking. The Forge
            // renders it whenever they open the order; this is for the minutes
            // between the turn ending and them going back to look — which on
            // the run that found this was the rest of the afternoon.
            api.notifications.showToast(
              'warning',
              `${order.title}: the architect's plan was refused and nothing changed.`,
              `foundry.converge.refused.${order.id}`
            )
            return
          }
          // The scout runs beside a first draft, so it may have stored its
          // findings while this turn was still writing.
          const drafted = withScoutContext(outcome.order, await store.load(order.id))
          await store.save(drafted)
          await store.record({
            at: new Date().toISOString(),
            orderId: order.id,
            actor: 'role:architect',
            action: 'order.redrafted',
            subject: order.id,
            reason: outcome.note === '' ? 'redrafted the plan' : outcome.note,
            evidence: [],
          })

          // The operator's "Hold for me" stops every automatic continuation,
          // this one included — a redraft that just landed still saves, but
          // nothing starts on its own from here until the operator releases it.
          if (loopFacts(await store.entries(order.id)).heldAt !== null) return

          const next = followUpFor(compileOrder(drafted).failures, autoTurns)
          if (next === null) {
            // Nothing left the architect can close on its own by compiling again.
            // If the order is otherwise ready, the red team gets a round before
            // the operator ever sees it — the whole point of the loop.
            if (shouldReview(drafted)) {
              // A fix turn is ready for hand-off unless the red team asked to see the fix.
              if (
                loopRound !== undefined &&
                afterFix({
                  order: drafted,
                  anotherPass: anotherPassWanted(await store.entries(order.id)),
                }) === 'hand-off'
              ) {
                await handOffWhenReady(drafted)
                return
              }
              await startReview(
                drafted,
                loopRound ?? (await nextReviewRound(order.id)),
                outcome.note
              )
            }
            return
          }
          await continueAutomatically(drafted, next, 'closing the failing checks on its own')
        }),
      loopRound !== undefined ? { loop: true } : undefined
    )
  }

  /**
   * One red-team round, and what happens with what it finds.
   *
   * `fix` sends every open blocking finding back to the architect as one
   * turn, on the loop's own model tier. `operator` is the loop giving up after
   * `MAX_REVIEW_ROUNDS` — the one point this whole feature still reaches the
   * operator. `clean` hands the order off, or says it is ready to.
   */
  const startReview = async (order: WorkOrder, round: number, changed: string): Promise<void> => {
    const root = dataRoot()
    const skipReason = round === 1 ? reviewSkipReason(order) : null
    if (skipReason !== null) {
      // Recorded rather than silent: the Forge reads this as the red team
      // step passed, with the reason, instead of a step still owed.
      await orderStoreAt(root).record({
        at: new Date().toISOString(),
        orderId: order.id,
        actor: 'rule:forge',
        action: 'review.skipped',
        subject: order.id,
        reason: skipReason,
        evidence: [],
      })
      await handOffWhenReady(order)
      return
    }
    // The scout runs beside the first draft, so what it found reaches the red
    // team from the store rather than from the draft it is attacking.
    await waitForScout(order.id)
    const attacked = withScoutContext(order, (await orderStoreAt(root).load(order.id)) ?? null)
    await readOnlyRound({
      api,
      root,
      order,
      roleId: 'red-team',
      nodeId: `review-${round}`,
      round,
      model: lighterRedTeam(api) ? lighterRedTeamModel(defaultModel(api)) : undefined,
      prompt: (role) => {
        const sources = resolveSources(api, root)
        return reviewPrompt({
          order: attacked,
          role,
          rules: rulesFor(sources, {
            repoPaths: sources.repoPaths,
            houseDocs: [...order.context.houseDocs],
          }).rules,
          outputPath: rungOutputPath(orderDir(root, order.id), `review-${round}`),
          round,
          changed,
        })
      },
      startedAction: 'review.started',
      startedReason: `round ${round}`,
      onFinished: (updated, anotherPass) =>
        deciding.during(order.id, async () => {
          // A refusal was already recorded by readOnlyRound, where the standing
          // reads it — nothing more to decide here.
          if (updated === null) return

          const store = orderStoreAt(root)
          // Only what is still open: a finding the architect already fixed or
          // the operator already accepted this same round is not what the
          // operator needs counted as still standing.
          const fresh = updated.redTeam.filter((f) => f.round === round && f.status === 'open')
          const blocking = fresh.filter(isBlocking).length
          const notes = fresh.length - blocking
          await store.record({
            at: new Date().toISOString(),
            orderId: order.id,
            actor: 'role:red-team',
            action: 'review.round',
            subject: order.id,
            reason: `round ${round}: ${blocking} blocking, ${notes} note${notes === 1 ? '' : 's'}`,
            evidence: [],
          })
          if (anotherPass === true) {
            await store.record({
              at: new Date().toISOString(),
              orderId: order.id,
              actor: 'role:red-team',
              action: 'review.another_pass',
              subject: order.id,
              reason: `round ${round} asked to review the fix`,
              evidence: [],
            })
          }

          // The operator's hold stops every automatic continuation this round
          // could lead to — the next round, "ready", or a fix turn — the same
          // as it stops a redraft's own follow-up.
          if (loopFacts(await store.entries(order.id)).heldAt !== null) return

          const next = reviewNext({ order: updated, round })
          if (next.kind === 'clean') {
            await handOffWhenReady(updated)
            return
          }
          if (next.kind === 'operator') {
            const stillOpen = updated.redTeam.filter(
              (f) => f.status === 'open' && isBlocking(f)
            ).length
            await store.record({
              at: new Date().toISOString(),
              orderId: order.id,
              actor: 'role:red-team',
              action: 'review.exhausted',
              subject: order.id,
              reason: `still has ${stillOpen} blocking finding${stillOpen === 1 ? '' : 's'} after ${MAX_REVIEW_ROUNDS} rounds`,
              evidence: [],
            })
            api.notifications.showToast(
              'warning',
              `${updated.title}: the red team still has ${stillOpen} blocking finding${stillOpen === 1 ? '' : 's'} after ${MAX_REVIEW_ROUNDS} rounds — it needs you.`,
              `foundry.review.exhausted.${order.id}`
            )
            return
          }
          // Recorded here, and not left to `convergeWithFollowUps`'s own
          // finish-time bookkeeping: the loop's fix turn is `converge.started`,
          // not `review.started`, and nothing recorded it starting at all —
          // the Forge read the ledger and saw no turn running while an
          // architect was in fact fixing the findings.
          const started = await convergeWithFollowUps(updated, next.message, 0, round + 1)
          await store.record({
            at: new Date().toISOString(),
            orderId: order.id,
            actor: 'role:architect',
            action: started.ok ? 'converge.started' : 'converge.refused',
            subject: started.ok ? started.sessionId : order.id,
            reason: started.ok ? `red team round ${round} fix` : started.reason,
            evidence: [],
          })
        }),
    })
  }

  /**
   * A draft that passes every check. One the operator never released waits
   * for their Hand off; one they released that a defect sent back is agreed
   * again and restarted (`forge/release-again.ts`).
   */
  const handOffWhenReady = async (order: WorkOrder): Promise<void> => {
    const store = orderStoreAt(dataRoot())
    await readyToHandOff(order, {
      entries: (orderId) => store.entries(orderId),
      agree: async (o) => {
        const r = (await channels().forge.compile({ id: o.id, commit: true, automatic: true })) as {
          error?: string
          order?: WorkOrder
          compile?: { failures: { detail: string }[] }
        }
        if (r.order?.status === 'agreed') return { ok: true }
        return {
          ok: false,
          reason: r.error ?? r.compile?.failures[0]?.detail ?? 'the order could not be agreed',
        }
      },
      start: async (o) => {
        const r = (await channels().runs.start({
          id: o.id,
          ...(o.recipeOverriddenBy === 'operator' && o.recipe !== null ? { recipe: o.recipe } : {}),
        })) as { error?: string; started?: boolean; reason?: string }
        if (r.error !== undefined) return { ok: false, reason: r.error }
        if (r.started === false) return { ok: false, reason: r.reason ?? 'nothing started the run' }
        return { ok: true }
      },
      refuse: async (o, reason) => {
        await store.record({
          at: new Date().toISOString(),
          orderId: o.id,
          actor: 'rule:forge',
          action: 'run.refused',
          subject: o.id,
          reason,
          evidence: [],
        })
        api.notifications.showToast(
          'warning',
          `${o.title} did not restart: ${reason}`,
          `foundry.release.refused.${o.id}`
        )
      },
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
    })
  }

  /**
   * Releasing a hold picks the loop back up from wherever it would have gone
   * on its own — the same three moves `onFinished` above already makes, just
   * entered from "the operator let go" rather than "a turn just finished".
   *
   * A draft only, and only once nothing is already running: a hold recorded
   * while nothing was in flight has nothing to resume, and one recorded over
   * a running turn is released the moment that turn's own `onFinished` reads
   * the ledger — starting a second thing here would race it.
   */
  const onReleased = (order: WorkOrder): void => {
    void (async () => {
      if (order.status !== 'draft') return
      const store = orderStoreAt(dataRoot())
      const entries = await store.entries(order.id)
      if (lastIntake(entries).kind === 'running') return

      const next = afterRelease(order, {
        loop: loopFacts(entries),
        reviewedCurrentPlan: reviewedCurrentPlan(entries),
      })
      if (next.kind === 'review') {
        await startReview(order, next.round, '')
      } else if (next.kind === 'hand-off') {
        await handOffWhenReady(order)
      } else if (next.kind === 'fix' || next.kind === 'follow-up') {
        const started = await convergeWithFollowUps(
          order,
          next.message,
          next.kind === 'fix' ? 0 : 1,
          next.kind === 'fix' ? next.round + 1 : undefined
        )
        await store.record({
          at: new Date().toISOString(),
          orderId: order.id,
          actor: 'role:architect',
          action: !started.ok
            ? 'converge.refused'
            : next.kind === 'fix'
              ? 'converge.started'
              : 'converge.followed_up',
          subject: started.ok ? started.sessionId : order.id,
          reason: !started.ok
            ? started.reason
            : next.kind === 'fix'
              ? `red team round ${next.round} fix`
              : 'closing the failing checks on its own',
          evidence: [],
        })
      }
    })()
  }

  /**
   * Beside the very first draft, the scout reads the repository; the
   * architect does not wait for it (ADR 084).
   *
   * Only for a first draft: `provenance.decisions` is empty until a proposal
   * has been applied, and `context.entryPoints` is empty until something has
   * populated it — an amending turn has both, and gets no scout of its own.
   *
   * The orchestration itself lives in `forge/scouted-converge.ts`, over
   * injected collaborators, so it is testable without a runner. This is just
   * the wiring.
   */
  const convergeMaybeScouted = (order: WorkOrder, message: string): Promise<ConvergeStarted> => {
    const root = dataRoot()
    return scoutedConverge(
      {
        // Settles when the scout's turn ends, so a red team that would start
        // meanwhile can wait for what it found.
        startScout: (scoutOrder) =>
          new Promise<void>((settled) => {
            void readOnlyRound({
              api,
              root,
              order: scoutOrder,
              roleId: 'scout',
              nodeId: 'forge-scout',
              prompt: (role) => {
                const sources = resolveSources(api, root)
                return brief({
                  order: scoutOrder,
                  role,
                  units: [],
                  rules: rulesFor(sources, {
                    repoPaths: sources.repoPaths,
                    houseDocs: [...scoutOrder.context.houseDocs],
                  }).rules,
                  outputPath: rungOutputPath(orderDir(root, scoutOrder.id), 'forge-scout'),
                })
              },
              startedAction: 'scout.started',
              startedReason: 'reading the repository beside the first draft',
              onFinished: async (updated) => {
                // A failure or an empty write was already recorded as
                // `scout.refused`; the architect never waited on it.
                if (updated === null) return settled()
                await orderStoreAt(root).record({
                  at: new Date().toISOString(),
                  orderId: scoutOrder.id,
                  actor: 'role:scout',
                  action: 'scout.collected',
                  subject: scoutOrder.id,
                  reason: `found ${updated.context.entryPoints.length} entry point${
                    updated.context.entryPoints.length === 1 ? '' : 's'
                  }`,
                  evidence: [],
                })
                settled()
              },
            }).catch(settled)
          }),
        startArchitect: (architectOrder, architectMessage) =>
          convergeWithFollowUps(architectOrder, architectMessage, 0),
      },
      order,
      message
    )
  }

  return { convergeWithFollowUps, convergeMaybeScouted, onReleased }
}
