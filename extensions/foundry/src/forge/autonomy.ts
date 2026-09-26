import type { CompileFailure } from '../order/compile.js'
import type { WorkOrder } from '../order/schema.js'

// Stop the operator only for what the architect cannot settle (spec 062,
// ADR-062).
//
// A choice the architect is at least this sure of is taken, and said as an
// assumption the operator can strike. A failing check the architect can close
// is handed back to it without anyone clicking. What is left for a person is a
// choice below the bar, a high-severity finding, or a plan that is still wrong
// after the automatic turns run out.

export const CONFIDENCE_BAR = 0.9

/** Turns the Forge starts on its own after the operator's. Bounded, so a plan it cannot fix stops rather than loops. */
export const MAX_AUTO_TURNS = 2

const percent = (confidence: number): string => `${Math.round(confidence * 100)}%`

export function decideConfidentQuestions(order: WorkOrder): WorkOrder {
  const decided: WorkOrder['assumptions'] = []
  const openQuestions = order.openQuestions.map((question) => {
    const option =
      question.recommended === null ? undefined : question.options[question.recommended]
    if (
      question.answer !== null ||
      option === undefined ||
      question.confidence === null ||
      question.confidence < CONFIDENCE_BAR
    ) {
      return question
    }
    decided.push({
      id: `A-${question.id}`,
      text: `${question.text} — decided: ${option} (${percent(question.confidence)} confident)`,
      struck: false,
      affects: [],
    })
    return { ...question, answer: option }
  })
  if (decided.length === 0) return order
  return { ...order, openQuestions, assumptions: [...order.assumptions, ...decided] }
}

export interface Dismissal {
  readonly id: string
  readonly reason: string
  readonly confidence: number
}

/** Accept the low and medium findings the architect is sure do not apply. High ones stay open. */
export function dismissConfidentFindings(
  order: WorkOrder,
  dismissals: readonly Dismissal[]
): WorkOrder {
  if (dismissals.length === 0) return order
  return {
    ...order,
    redTeam: order.redTeam.map((finding) => {
      const dismissal = dismissals.find((d) => d.id === finding.id)
      if (
        dismissal === undefined ||
        finding.status !== 'open' ||
        finding.severity === 'high' ||
        dismissal.confidence < CONFIDENCE_BAR ||
        dismissal.reason.trim() === ''
      ) {
        return finding
      }
      return {
        ...finding,
        status: 'accepted' as const,
        reason: `architect, ${percent(dismissal.confidence)} confident: ${dismissal.reason.trim()}`,
      }
    }),
  }
}

/** What to send the architect next without asking anyone, or null to stop. */
export function followUpFor(
  failures: readonly CompileFailure[],
  autoTurnsSoFar: number
): string | null {
  if (autoTurnsSoFar >= MAX_AUTO_TURNS) return null
  const closable = failures.filter((failure) => failure.check !== 'questions')
  if (closable.length === 0) return null
  return [
    'The order still fails these checks. Close each one yourself — decide anything',
    'you are at least 90% sure of rather than asking:',
    '',
    ...closable.map((failure) => `- ${failure.check} — ${failure.detail}`),
  ].join('\n')
}
