import type { WorkItemContract } from './contract-schema.js'
import { gateIsReviewable as isReviewable } from '../../../shared/supervision/gate-reviewable.js'

// The deliberate friction (FR-083). Implementation cannot begin until the
// operator has approved both the specification and the plan.
//
// This is the mechanism the spec cites as the answer to unbounded scope: an
// agent that starts without an approved spec has nothing bounding what it may
// do, which is how a 2.4M-line pull request happens.

const REQUIRED_GATES = ['spec_approved_by_human', 'plan_approved_by_human'] as const

export type RequiredGate = (typeof REQUIRED_GATES)[number]

export interface GateDecision {
  readonly allowed: boolean
  /** Named, not merely refused — the operator has to know what to go and do. */
  readonly missing: RequiredGate[]
  readonly reason: string | null
}

const GATE_LABELS: Record<RequiredGate, string> = {
  spec_approved_by_human: 'the specification',
  plan_approved_by_human: 'the plan',
}

export function mayBeginImplementation(item: WorkItemContract): GateDecision {
  const missing = REQUIRED_GATES.filter((gate) => item.gates[gate]?.ok !== true)

  if (missing.length === 0) return { allowed: true, missing: [], reason: null }

  return {
    allowed: false,
    missing,
    reason: `${missing.map((gate) => GATE_LABELS[gate]).join(' and ')} ${
      missing.length === 1 ? 'has' : 'have'
    } not been approved`,
  }
}

/** Whether an artefact the operator is being asked to approve actually exists. */
export function gateIsReviewable(item: WorkItemContract, gate: RequiredGate): boolean {
  return isReviewable(item.artifacts, gate)
}
