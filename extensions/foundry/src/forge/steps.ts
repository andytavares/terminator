import type { WorkOrder } from '../order/schema.js'
import type { CheckId, CompileResult } from '../order/compile.js'

// The Forge, as the sequence an operator walks to agree an order.
//
// Each failing check is placed on the step where the control that clears it
// lives, so the step list is also the map of what is holding hand-off up. The
// open questions are on no step: they have the band above all of them.

export type StepId = 'intent' | 'plan' | 'redTeam' | 'shape' | 'tracker' | 'handOff'

export interface ForgeStep {
  readonly id: StepId
  /** The failing checks that are cleared on this step. */
  readonly blocking: readonly CheckId[]
}

const STEP_CHECKS: Record<StepId, readonly CheckId[]> = {
  intent: [],
  plan: ['verifiable', 'coverage', 'risk', 'budgets'],
  redTeam: ['redTeam'],
  shape: [],
  tracker: [],
  handOff: [],
}

const SEQUENCE: readonly StepId[] = ['intent', 'plan', 'redTeam', 'shape', 'tracker', 'handOff']

export function forgeSteps(
  compile: CompileResult,
  offers: { readonly shape: boolean; readonly tracker: boolean }
): ForgeStep[] {
  const failed = compile.failures.map((failure) => failure.check)
  return SEQUENCE.filter((id) =>
    id === 'shape' ? offers.shape : id === 'tracker' ? offers.tracker : true
  ).map((id) => ({ id, blocking: STEP_CHECKS[id].filter((check) => failed.includes(check)) }))
}

/**
 * The step an order opens on: where the next thing to do is.
 *
 * A draft nobody has planned yet opens where the plan is drafted; a planned one
 * on the first step still blocking; anything else on hand-off.
 */
export function openingStep(order: WorkOrder, steps: readonly ForgeStep[]): StepId {
  if (order.status !== 'draft') return 'handOff'
  if (order.acceptance.length === 0) return 'intent'
  return steps.find((step) => step.blocking.length > 0)?.id ?? 'handOff'
}
