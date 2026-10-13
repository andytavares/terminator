import {
  shipModeFor,
  openDrafts,
  watchAndFinish,
  commitAndPushLanes,
  refreshBodies,
} from './integrate.js'
import type { IntegrateDeps, Shipment, ShippedDrafts, ShipOutcome } from './integrate.js'
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

/** What an early ship holds between the final check starting and the executor returning. */
interface EarlyShipState {
  opened: Opened | null
  /** The order at the grade the change turned out to deserve. */
  regraded: WorkOrder
}

export function createEarlyShip(input: EarlyShipInput) {
  const state: EarlyShipState = { opened: null, regraded: input.order }
  return {
    /** Whether the drafts were opened ahead of the final check. */
    get opened(): boolean {
      return state.opened !== null
    },
    /** The executor's `beforeFinalCheck`. */
    beforeFinalCheck: (args: { risk: RiskAssessment; verdicts: readonly Verdict[] }) =>
      openEarly(input, state, args),
    /**
     * After the executor returned. Null when nothing was opened early, or the
     * run is not shippable — the draft then stays a draft and the executor's own
     * gate is the operator's next move.
     */
    finish: (run: RunOutcome) => finishEarly(input, state, run),
  }
}

async function openEarly(
  input: EarlyShipInput,
  state: EarlyShipState,
  args: { risk: RiskAssessment; verdicts: readonly Verdict[] }
): Promise<boolean> {
  state.regraded = { ...input.order, risk: args.risk }
  if (shipModeFor(state.regraded) === 'gate_then_push') return false

  const shipment = input.shipment({
    verdicts: args.verdicts,
    ladder: null,
    inspectionRequired: false,
    reason: '',
  })
  const outcome = await openDrafts(state.regraded, shipment, input.deps)
  if (outcome.held) {
    state.opened = { outcome, ci: Promise.resolve({ ok: { kind: 'none' } }) }
    return false
  }
  state.opened = { outcome, ci: settledWatch(input.deps, outcome.pulls) }
  return true
}

/** The CI watch, started now and settled either way so it can never reject unhandled. */
function settledWatch(deps: IntegrateDeps, pulls: ShipOutcome['pulls']): Opened['ci'] {
  const watch = deps.watchCi
  if (watch === undefined) return Promise.resolve({ ok: { kind: 'none' } as CiOutcome })
  return watch(pulls).then(
    (value) => ({ ok: value }),
    (failed: unknown) => ({ failed })
  )
}

async function finishEarly(
  input: EarlyShipInput,
  state: EarlyShipState,
  run: RunOutcome
): Promise<ShipOutcome | null> {
  if (state.opened === null) return null
  const { outcome, ci } = state.opened
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
  const { regraded } = state
  // A format step that writes leaves the checkout ahead of what CI saw.
  // What it committed is pushed, and CI is watched again on that commit.
  const written = run.ladder?.steps.find((s) => s.rung === 'L0')?.name ?? 'ladder'
  const message = `final check: ${written.toLowerCase()}`
  const committed = await commitAndPushLanes(regraded, message, input.deps)
  await refreshBodies(regraded, { shipment, pulls: outcome.pulls }, input.deps)

  const first = await ci
  if (committed && input.deps.watchCi !== undefined) {
    return watchAndFinish(regraded, { shipment, drafts: outcome }, input.deps)
  }
  if ('failed' in first) throw first.failed
  return finishWith(regraded, { shipment, drafts: outcome, ci: first.ok }, input.deps)
}

async function finishWith(
  order: WorkOrder,
  { shipment, drafts, ci }: ShippedDrafts,
  deps: IntegrateDeps
): Promise<ShipOutcome> {
  // The CI watch already ran beside the final check; `watchAndFinish` with a
  // watcher that answers from it keeps one definition of "watch, then finish".
  return watchAndFinish(order, { shipment, drafts }, { ...deps, watchCi: async () => ci })
}
