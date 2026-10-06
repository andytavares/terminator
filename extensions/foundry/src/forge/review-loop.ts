import { brief } from '../line/brief.js'
import { compileOrder } from '../order/compile.js'
import { isBlocking } from '../order/schema.js'
import type { WorkOrder } from '../order/schema.js'
import type { Role, Rule } from '../recipe/parse.js'
import { followUpFor } from './autonomy.js'
import type { LoopFacts } from './readiness.js'

// The Forge's own red team, argued before the operator sees it.
//
// The red team used to run on the Line, after the order was agreed, where
// every finding stopped a run already building from the order. Here it runs
// inside the Forge: the architect drafts, the red team attacks, the architect
// fixes every blocking finding in one turn, and the red team attacks the fix
// only when it asked to (ADR 075). See docs/research/foundry-red-team-loop.md.

/** At most this many rounds before the operator is asked instead. */
export const MAX_REVIEW_ROUNDS = 3

export interface ReviewPromptInput {
  readonly order: WorkOrder
  readonly role: Role | null
  readonly rules: readonly Rule[]
  readonly outputPath: string
  readonly round: number
  /** The architect's own note on what it changed, for round 2 and later. */
  readonly changed?: string
}

/**
 * The red team's brief for one round.
 *
 * Round 1 attacks the whole order, the same brief intake has always built.
 * Round 2 and later name what changed since the last round, when there is
 * something to name — a red team told to attack only the redraft cannot
 * re-litigate what it already settled.
 */
export function reviewPrompt(input: ReviewPromptInput): string {
  const { order, role, rules, outputPath, round, changed } = input
  const base = brief({ order, role, units: [], rules, outputPath })
  const sections = [base]
  const scout = scoutFindingsSection(order)
  if (scout !== null) sections.push('', scout)
  sections.push('', `## Round ${round}`)

  if (round > 1 && changed !== undefined && changed.trim() !== '') {
    sections.push(
      '',
      '## What changed since the last round',
      '',
      changed.trim(),
      '',
      'Attack only this.'
    )
  }

  return sections.join('\n')
}

/**
 * What the scout read, for the red team to check the plan against.
 *
 * The scout now runs beside the first draft rather than ahead of it, so the
 * architect may never have seen these; the red team is the reader that does.
 */
export function scoutFindingsSection(order: WorkOrder): string | null {
  const { entryPoints, priorArt, conventions } = order.context
  const groups: [string, readonly string[]][] = [
    ['Entry points', entryPoints],
    ['Prior art', priorArt],
    ['Conventions', conventions],
  ]
  const lines = groups.flatMap(([title, items]) =>
    items.length === 0 ? [] : ['', `${title}:`, ...items.map((item) => `- ${item}`)]
  )
  return lines.length === 0 ? null : ['## What the scout found', ...lines].join('\n')
}

/**
 * Why this order needs no red-team round, or null when it does (ADR 084).
 *
 * The Direct shape's own test: graded P3, one lane, no risk triggers. An order
 * that small has given the red team nothing to catch that the six compile
 * checks do not — and an open blocking finding is never skipped over, since
 * it is the architect's fix turn that is owed.
 */
export function reviewSkipReason(order: WorkOrder): string | null {
  if (order.risk.grade !== 'P3') return null
  if (order.risk.triggers.length > 0) return null
  if (new Set(order.plan.units.map((unit) => unit.lane)).size !== 1) return null
  if (fixMessage(order) !== null) return null
  return 'graded P3, one lane, no risk triggers'
}

/**
 * The model for a red team the operator asked to keep light: the balanced
 * tier. An empty choice means the operator configures the model themselves,
 * and stays theirs.
 */
export function lighterRedTeamModel(chosen: string): string {
  return chosen === '' ? '' : 'sonnet'
}

/**
 * Every open blocking finding, told to the architect in one turn.
 *
 * Null when there is nothing to fix — a message with no findings in it would
 * be an instruction to do nothing, sent anyway.
 */
export function fixMessage(order: WorkOrder): string | null {
  const open = order.redTeam.filter((f) => f.status === 'open' && isBlocking(f))
  if (open.length === 0) return null

  return [
    'The red team raised findings that block hand-off. Fix every one of these',
    'in the plan, and list it in `resolveFindings` with what you changed — or,',
    'when you are at least 90% sure it does not apply here, list it in',
    '`dismissFindings` with the reason. A note (not listed below) needs',
    'nothing from you.',
    '',
    ...open.map((f) => `- ${f.id} (${f.category}, ${f.severity}) — ${f.text}`),
  ].join('\n')
}

export type ReviewNext =
  | { readonly kind: 'fix'; readonly message: string }
  | { readonly kind: 'operator' }
  | { readonly kind: 'clean' }

/** What happens after one red-team round, given what it left open. */
export function reviewNext(input: {
  readonly order: WorkOrder
  readonly round: number
}): ReviewNext {
  const message = fixMessage(input.order)
  if (message === null) return { kind: 'clean' }
  if (input.round >= MAX_REVIEW_ROUNDS) return { kind: 'operator' }
  return { kind: 'fix', message }
}

/**
 * Where the loop goes once the architect has answered a round's findings.
 *
 * One pass is the default: a fix the red team did not ask to see again hands
 * off. It is reviewed again only when the red team asked for that, or when
 * the architect left a blocking finding standing — `reviewNext` still stops
 * the loop at `MAX_REVIEW_ROUNDS`.
 */
export function afterFix(input: {
  readonly order: WorkOrder
  readonly anotherPass: boolean
}): 'review' | 'hand-off' {
  return input.anotherPass || fixMessage(input.order) !== null ? 'review' : 'hand-off'
}

/**
 * Whether this order is ready for a red-team round.
 *
 * True only when every other compile check already passes — questions
 * answered, criteria verifiable, coverage complete, risk taken against this
 * plan. An order still waiting on the operator's answers is not reviewed: the
 * red team would be attacking a plan that is about to change underneath it.
 */
export function shouldReview(order: WorkOrder): boolean {
  return compileOrder(order).failures.every((failure) => failure.check === 'redTeam')
}

/** The round after the last one recorded, or 1 when none has run. */
export function nextRound(loop: LoopFacts): number {
  return loop.rounds.length === 0 ? 1 : loop.rounds[loop.rounds.length - 1].round + 1
}

export type ReleaseNext =
  | { readonly kind: 'review'; readonly round: number }
  | { readonly kind: 'fix'; readonly message: string; readonly round: number }
  | { readonly kind: 'follow-up'; readonly message: string }
  | { readonly kind: 'hand-off' }
  | { readonly kind: 'nothing' }

/**
 * Where the loop goes when the operator lets a held order continue.
 *
 * The same move the loop would have made had it not been held: a plan the
 * red team has not seen is reviewed, open blocking findings go back to the
 * architect, any other failing check gets a follow-up, and a plan that passed
 * its review is handed off. A loop that already gave up stays the operator's.
 */
export function afterRelease(
  order: WorkOrder,
  facts: { readonly loop: LoopFacts; readonly reviewedCurrentPlan: boolean }
): ReleaseNext {
  const failures = compileOrder(order).failures
  if (failures.some((failure) => failure.check === 'questions')) return { kind: 'nothing' }

  const followUp = followUpFor(
    failures.filter((failure) => failure.check !== 'redTeam'),
    0
  )
  if (followUp !== null) return { kind: 'follow-up', message: followUp }

  if (!facts.reviewedCurrentPlan) return { kind: 'review', round: nextRound(facts.loop) }

  const fix = fixMessage(order)
  if (fix === null) return { kind: 'hand-off' }
  if (facts.loop.exhausted) return { kind: 'nothing' }
  return { kind: 'fix', message: fix, round: nextRound(facts.loop) - 1 }
}
