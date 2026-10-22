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

/** @internal */
export const QUESTION_BUDGET = 3

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
 * possible answer really is one keystroke; a list of numbers is several at
 * once, for a question whose options can all be true together. An index that
 * names no option is ignored rather than stored as an answer nobody gave.
 */
export function answerQuestion(
  questions: readonly OpenQuestion[],
  id: string,
  answer: string | number | readonly number[]
): OpenQuestion[] {
  return questions.map((question) => {
    if (question.id !== id) return question
    if (typeof answer === 'string') return { ...question, answer, chosen: [] }
    const chosen = validIndices(question.options, typeof answer === 'number' ? [answer] : answer)
    if (chosen.length === 0 || (chosen.length > 1 && !question.multiple)) return question
    return {
      ...question,
      chosen,
      answer: chosen.map((index) => question.options[index]).join('; '),
    }
  })
}

/** The distinct indices that name an option, in option order. */
function validIndices(options: readonly string[], indices: readonly number[]): number[] {
  return options.map((_, index) => index).filter((index) => indices.includes(index))
}
