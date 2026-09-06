import { GATE_RULES } from './rules.js'
import type { GateRuleId } from './rules.js'

// The autonomy dial.
//
// It is not "how chatty is the agent". It selects which rules are allowed to
// stop for you, and four of them are live at every setting — so the most
// permissive setting is still not unattended shipping. It will open a draft
// pull request without you; it will not mark one ready, and it will not merge.

export const AUTONOMY_LEVELS = ['escorted', 'standard', 'lights-out'] as const
export type Autonomy = (typeof AUTONOMY_LEVELS)[number]

/**
 * Live at every setting, including the most permissive.
 *
 * Risk, budget, destruction and the merge decision. Everything else is a
 * matter of taste; these four are the difference between a factory and a
 * machine that ships whatever it happens to produce.
 */
export const UNCONDITIONAL: readonly GateRuleId[] = [
  'risk.p0',
  'budget.exceeded',
  'destructive',
  'ready-for-review',
]

const STANDARD_EXTRA: readonly GateRuleId[] = [
  'verify.repeat-fail',
  'critical-path',
  'new-dependency',
  'forge-defect',
]

export function liveRules(autonomy: Autonomy): Set<GateRuleId> {
  switch (autonomy) {
    case 'escorted':
      // Everything, including a stop at each unit boundary.
      return new Set(GATE_RULES)
    case 'standard':
      return new Set([...UNCONDITIONAL, ...STANDARD_EXTRA])
    case 'lights-out':
      return new Set(UNCONDITIONAL)
  }
}

export function isLive(rule: GateRuleId, autonomy: Autonomy): boolean {
  return liveRules(autonomy).has(rule)
}

/** Rules this setting silences, so the surface can say what it is not asking. */
export function silencedRules(autonomy: Autonomy): GateRuleId[] {
  const live = liveRules(autonomy)
  return GATE_RULES.filter((rule) => !live.has(rule))
}
