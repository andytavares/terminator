import {
  shipModeFor,
  openDrafts,
  watchAndFinish,
  commitAndPushLanes,
  refreshBodies,
} from './integrate.js'
import type { IntegrateDeps, LanePullRequest, Shipment, ShipOutcome } from './integrate.js'
import type { CiOutcome } from './ship-tail.js'
import type { RunOutcome } from './executor.js'
import type { RiskAssessment, WorkOrder } from '../order/schema.js'
import type { Verdict } from '../verify/verdict.js'

// The draft opens before the final check, and the check runs while CI does
// (ADR 085). This is the tail's half of that: the executor calls
// `beforeFinalCheck` once the work is done, and `finish` runs after it returns.
//
// Nothing here applies when the operator must decide before anything reaches
// the remote — a graded P0/P1 change, or one that owes an inspection. Those
// keep the old order, and `beforeFinalCheck` answers false for them.

interface Opened {
  readonly outcome: ShipOutcome
  /** Settled either way, so a failed CI watch cannot become an unhandled rejection. */
  readonly ci: Promise<{ ok: CiOutcome } | { failed: unknown }>
}

export interface EarlyShipInput {
  readonly order: WorkOrder
  readonly deps: IntegrateDeps
  /** What the shipment says that the executor does not know until it ends. */
  readonly shipment: (outcome: {
    verdicts: readonly Verdict[]
    ladder: RunOutcome['ladder']
    inspectionRequired: boolean
    reason: string
  }) => Shipment
}

export function createEarlyShip(input: EarlyShipInput) {
  let opened: Opened | null = null
  let regraded: WorkOrder = input.order

  return {
    /** Whether the drafts were opened ahead of the final check. */
    get opened(): boolean {
      return opened !== null
    },

    /** The executor's `beforeFinalCheck`. */
    async beforeFinalCheck(args: {
      risk: RiskAssessment
      verdicts: readonly Verdict[]
    }): Promise<boolean> {
      regraded = { ...input.order, risk: args.risk }
      if (shipModeFor(regraded) === 'gate_then_push') return false

      const shipment = input.shipment({
        verdicts: args.verdicts,
        ladder: null,
        inspectionRequired: false,
        reason: '',
      })
      const outcome = await openDrafts(regraded, shipment, input.deps)
      if (outcome.held) {
        opened = { outcome, ci: Promise.resolve({ ok: { kind: 'none' } }) }
        return false
      }
      const watch = input.deps.watchCi
      const ci =
        watch === undefined
          ? Promise.resolve({ ok: { kind: 'none' } as CiOutcome })
          : watch(outcome.pulls).then(
              (value) => ({ ok: value }),
              (failed: unknown) => ({ failed })
            )
      opened = { outcome, ci }
      return true
    },

    /**
     * After the executor returned. Null when nothing was opened early, or the
     * run is not shippable — the draft then stays a draft and the executor's own
     * gate is the operator's next move.
     */
    async finish(run: RunOutcome): Promise<ShipOutcome | null> {
      if (opened === null) return null
      const { outcome, ci } = opened
      if (outcome.held) return outcome
      // The CI watch is not awaited: the executor's gate is the next move, and
      // `ci` is already settled-wrapped, so nothing is left unhandled.
      if (!run.shippable) return null

      const shipment = input.shipment({
        verdicts: run.verdicts,
        ladder: run.ladder,
        inspectionRequired: run.inspection.required,
        reason: run.inspection.reason,
      })
      // A format step that writes leaves the checkout ahead of what CI saw.
      // What it committed is pushed, and CI is watched again on that commit.
      const written = run.ladder?.steps.find((s) => s.rung === 'L0')?.name ?? 'ladder'
      const committed = await commitAndPushLanes(
        regraded,
        `final check: ${written.toLowerCase()}`,
        input.deps
      )
      await refreshBodies(regraded, shipment, outcome.pulls, input.deps)

      const first = await ci
      if (committed && input.deps.watchCi !== undefined) {
        return watchAndFinish(regraded, shipment, outcome.pulls, outcome.bodyPaths, input.deps)
      }
      if ('failed' in first) throw first.failed
      return finishWith(regraded, shipment, outcome.pulls, outcome.bodyPaths, first.ok, input.deps)
    },
  }
}

async function finishWith(
  order: WorkOrder,
  shipment: Shipment,
  pulls: readonly LanePullRequest[],
  bodyPaths: readonly string[],
  ci: CiOutcome,
  deps: IntegrateDeps
): Promise<ShipOutcome> {
  // The CI watch already ran beside the final check; `watchAndFinish` with a
  // watcher that answers from it keeps one definition of "watch, then finish".
  return watchAndFinish(order, shipment, pulls, bodyPaths, { ...deps, watchCi: async () => ci })
}
