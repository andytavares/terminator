import type { OpenQuestion } from '../order/schema.js'

// What the operator is actually asked.
//
// The design goal is that ten decisions cost one scan, not ten answers. Almost
// everything the Forge decides is stated as a strikeable assumption instead of
// asked; what survives as a question is only what the repository, the source
// issue and the project's own conventions cannot settle.
//
// Three at a time, ranked by how much of the plan each one would change. The
// budget is not a display limit — it is the thing that keeps intake from
// degenerating into an interrogation, which is what the tool this replaces did.

export const QUESTION_BUDGET = 3

/** A question with what it holds up, before it has been given a rank. */
export interface RankableQuestion extends OpenQuestion {
  /** Unit and criterion ids this question would change the shape of. */
  readonly affects: readonly string[]
}

/**
 * The questions to put in front of the operator, most consequential first.
 *
 * Answering one reveals the next, so the budget stays full rather than the
 * operator being asked three questions and then three more.
 */
export function surfacedQuestions(questions: readonly OpenQuestion[]): OpenQuestion[] {
  return questions
    .filter((q) => q.answer === null)
    .slice()
    .sort((a, b) => b.rank - a.rank)
    .slice(0, QUESTION_BUDGET)
}

/**
 * Record an answer.
 *
 * A number is an index into the question's own options, so the cheapest
 * possible answer really is one keystroke. An index that names no option is
 * ignored rather than stored as an answer nobody gave.
 */
export function answerQuestion(
  questions: readonly OpenQuestion[],
  id: string,
  answer: string | number
): OpenQuestion[] {
  return questions.map((question) => {
    if (question.id !== id) return question
    if (typeof answer === 'number') {
      const chosen = question.options[answer]
      return chosen === undefined ? question : { ...question, answer: chosen }
    }
    return { ...question, answer }
  })
}

/**
 * Rank by blast radius: a question that changes three units outranks one that
 * changes one, because answering it unblocks more of the draft.
 */
export function rankQuestions(questions: readonly RankableQuestion[]): OpenQuestion[] {
  return questions
    .map((question) => ({ ...question, rank: question.affects.length }))
    .sort((a, b) => b.rank - a.rank)
    .map(({ affects: _affects, ...question }) => question)
}
