import { brief } from '../line/brief.js'
import { compileOrder } from '../order/compile.js'
import { isBlocking } from '../order/schema.js'
import type { WorkOrder } from '../order/schema.js'
import type { Role, Rule } from '../recipe/parse.js'

// The Forge's own red team, argued to a fixed point before the operator sees it.
//
// The red team used to run on the Line, after the order was agreed, where
// every finding stopped a run already building from the order. Here it runs
// inside the Forge: the architect drafts, the red team attacks, the architect
// fixes every blocking finding in one turn, and the red team attacks only what
// changed. See docs/research/foundry-red-team-loop.md ("Design → Loop").

/** Argued this many rounds before the operator is asked instead. */
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
  const sections = [base, '', `## Round ${round}`]

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
