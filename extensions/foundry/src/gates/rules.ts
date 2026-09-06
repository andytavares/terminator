import type { Evidence } from '../verify/verdict.js'

// A gate is a row raised by a named rule, not a checkpoint stapled to a phase.
//
// That is the whole difference between nought-to-two decisions per order and
// nine. If no rule fires, nothing stops — and every request that does reach
// the operator can say which rule produced it and what it looked at, so an
// interruption is never a mystery.

export const GATE_RULES = [
  'risk.p0',
  'budget.exceeded',
  'destructive',
  'ready-for-review',
  'verify.repeat-fail',
  'critical-path',
  'new-dependency',
  'forge-defect',
  'unit.boundary',
] as const

export type GateRuleId = (typeof GATE_RULES)[number]

export interface GateOption {
  readonly id: string
  readonly label: string
  /** What happens if this is chosen. Shown, not implied. */
  readonly consequence: string
}

export interface GateDecision {
  readonly option: string
  readonly by: 'operator' | 'default'
  readonly note: string
  readonly at: string
}

export interface Gate {
  readonly id: string
  readonly rule: GateRuleId
  readonly orderId: string
  readonly nodeId: string | null
  /** What the operator is being asked, in one line. */
  readonly summary: string
  /** Why the rule fired. Never empty — an unattributed interruption is a bug. */
  readonly why: string
  readonly evidence: readonly Evidence[]
  readonly options: readonly GateOption[]
  readonly defaultIfIgnored: string
  readonly deadline: string | null
  /** How much work this decision unblocks. Feeds the ranking. */
  readonly blockedUnits: number
  readonly riskGrade: 'P0' | 'P1' | 'P2' | 'P3'
  readonly raisedAt: string
  readonly decision: GateDecision | null
}

const HOLD: GateOption = {
  id: 'hold',
  label: 'Hold',
  consequence: 'Nothing proceeds until you come back to it.',
}

/** The options each rule offers, and what happens when nobody answers. */
const RULE_SHAPE: Record<GateRuleId, { options: GateOption[]; defaultIfIgnored: string }> = {
  'risk.p0': {
    options: [
      { id: 'approve', label: 'Approve', consequence: 'The change proceeds as it stands.' },
      {
        id: 'send_back',
        label: 'Send back',
        consequence: 'The unit is reopened for another attempt.',
      },
      HOLD,
    ],
    defaultIfIgnored: 'hold',
  },
  'budget.exceeded': {
    options: [
      { id: 'raise', label: 'Raise the budget', consequence: 'Work continues with more room.' },
      { id: 'stop', label: 'Stop here', consequence: 'The order is cancelled and reconciled.' },
      HOLD,
    ],
    defaultIfIgnored: 'hold',
  },
  destructive: {
    options: [
      { id: 'approve', label: 'Approve', consequence: 'The destructive step runs.' },
      { id: 'skip', label: 'Skip it', consequence: 'The step is skipped and recorded as skipped.' },
      HOLD,
    ],
    defaultIfIgnored: 'hold',
  },
  'ready-for-review': {
    options: [
      { id: 'mark_ready', label: 'Mark ready', consequence: 'The draft becomes a review request.' },
      HOLD,
    ],
    // Never a deadline default that ships: silence must not merge anything.
    defaultIfIgnored: 'hold',
  },
  'verify.repeat-fail': {
    options: [
      { id: 'send_back', label: 'Send back', consequence: 'A third attempt begins.' },
      { id: 'take_over', label: 'Take over', consequence: 'You are dropped into the session.' },
      {
        id: 'accept_debt',
        label: 'Accept the debt',
        consequence: 'The criterion is accepted unmet, in writing.',
      },
      HOLD,
    ],
    defaultIfIgnored: 'hold',
  },
  'critical-path': {
    options: [
      {
        id: 'approve',
        label: 'Approve',
        consequence: 'The change proceeds into the critical path.',
      },
      { id: 'send_back', label: 'Send back', consequence: 'The unit is reopened.' },
      HOLD,
    ],
    defaultIfIgnored: 'hold',
  },
  'new-dependency': {
    options: [
      { id: 'approve', label: 'Approve', consequence: 'The dependency stays.' },
      { id: 'send_back', label: 'Send back', consequence: 'The unit is reopened without it.' },
      HOLD,
    ],
    defaultIfIgnored: 'hold',
  },
  'forge-defect': {
    options: [
      {
        id: 'answer',
        label: 'Answer',
        consequence: 'Work resumes, and intake is marked defective.',
      },
      HOLD,
    ],
    defaultIfIgnored: 'hold',
  },
  'unit.boundary': {
    options: [{ id: 'continue', label: 'Continue', consequence: 'The next unit starts.' }, HOLD],
    defaultIfIgnored: 'hold',
  },
}

export interface RaiseInput {
  readonly id: string
  readonly rule: GateRuleId
  readonly orderId: string
  readonly nodeId?: string | null
  readonly summary: string
  readonly why: string
  readonly evidence?: readonly Evidence[]
  readonly blockedUnits?: number
  readonly riskGrade?: Gate['riskGrade']
  readonly deadline?: string | null
  readonly at: string
}

export class UnattributedGateError extends Error {
  readonly code = 'UNATTRIBUTED_GATE'
  constructor() {
    super(
      'A gate must say which rule raised it and why. An interruption the operator cannot attribute is one they learn to dismiss.'
    )
    this.name = 'UnattributedGateError'
  }
}

/**
 * Raise a gate.
 *
 * The rule and the reason are required, structurally. A gate that cannot say
 * why it exists is exactly the kind of interruption that trains an operator to
 * click through without reading.
 */
export function raiseGate(input: RaiseInput): Gate {
  if (input.why.trim() === '') throw new UnattributedGateError()
  const shape = RULE_SHAPE[input.rule]

  // A default naming an option the gate does not offer would produce a
  // decision nobody could have made. Caught here rather than at the moment a
  // deadline passes, unattended, which is the worst possible time to find out.
  if (!shape.options.some((option) => option.id === shape.defaultIfIgnored)) {
    throw new Error(
      `The "${input.rule}" rule defaults to "${shape.defaultIfIgnored}", which is not one of the options it offers.`
    )
  }

  return {
    id: input.id,
    rule: input.rule,
    orderId: input.orderId,
    nodeId: input.nodeId ?? null,
    summary: input.summary,
    why: input.why,
    evidence: input.evidence ?? [],
    options: shape.options,
    defaultIfIgnored: shape.defaultIfIgnored,
    deadline: input.deadline ?? null,
    blockedUnits: input.blockedUnits ?? 0,
    riskGrade: input.riskGrade ?? 'P3',
    raisedAt: input.at,
    decision: null,
  }
}

export class AlreadyDecidedError extends Error {
  readonly code = 'GATE_ALREADY_DECIDED'
  constructor(id: string) {
    super(`Gate ${id} has already been decided. A decision is made once.`)
    this.name = 'AlreadyDecidedError'
  }
}

export function decide(gate: Gate, option: string, note: string, at: string): Gate {
  if (gate.decision !== null) throw new AlreadyDecidedError(gate.id)
  if (!gate.options.some((o) => o.id === option)) {
    throw new Error(`"${option}" is not one of the options on gate ${gate.id}.`)
  }
  return { ...gate, decision: { option, by: 'operator', note, at } }
}

/**
 * Take the stated default because nobody answered in time.
 *
 * Recorded as automatic rather than silently applied — the point of a default
 * is that the operator can find out later what happened while they were away.
 */
export function applyDefault(gate: Gate, at: string): Gate {
  if (gate.decision !== null) return gate
  return {
    ...gate,
    decision: {
      option: gate.defaultIfIgnored,
      by: 'default',
      note: 'no answer by the deadline',
      at,
    },
  }
}

export function isOverdue(gate: Gate, now: string): boolean {
  return gate.decision === null && gate.deadline !== null && gate.deadline <= now
}
