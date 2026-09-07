import type { AcceptanceCriterion } from '../order/schema.js'

// A ticket that states its acceptance criteria, taken at its word.
//
// The description arrived whole in `intent.problem` and nothing read it, so an
// order seeded from a ticket with a heading literally called "Acceptance
// Criteria" opened saying **"No criteria yet"**. Technically true — those were
// the *order's* criteria, and the architect writes those — and useless to the
// person who had just written them down.
//
// This does not do the architect's job. It lifts what the ticket already
// states so the order starts from it, and the plan is still required: coverage
// runs both ways, so a criterion satisfied by no unit fails the compile just
// as it did before. What changes is that the operator's own words survive the
// journey.

/** The heading that means "here is what done looks like", however it is spelt. */
const ACCEPTANCE_HEADING =
  /^#{1,6}\s*(acceptance(\s+criteria)?|criteria|definition\s+of\s+done|done\s+when)\s*:?\s*$/i

/** A list item, bulleted or numbered, task box or not. */
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.*)$/

/**
 * The criteria a ticket states, or none.
 *
 * Only from under an acceptance heading: a bare list somewhere in a
 * description is as likely to be reproduction steps or a checklist of links,
 * and inventing criteria out of one would be worse than finding none.
 */
export function acceptanceFromTicket(description: string): AcceptanceCriterion[] {
  const lines = description.replace(/\r\n?/g, '\n').split('\n')
  const statements: string[] = []
  let inside = false

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line.trim())) {
      // A new heading ends the section — including another acceptance heading,
      // which simply starts it again.
      inside = ACCEPTANCE_HEADING.test(line.trim())
      continue
    }
    if (!inside) continue
    const item = ITEM.exec(line)
    if (item !== null) {
      const statement = item[1].trim()
      if (statement !== '') statements.push(statement)
      continue
    }
    // Prose under the heading is not a criterion, and does not end the section
    // either: a sentence of preamble before the list is ordinary.
  }

  return statements.map((statement, index) => ({
    id: `AC-${index + 1}`,
    statement,
    priority: 'P1' as const,
    // A rubric with named evidence, which is what the ticket actually gave:
    // a sentence somebody has to judge. The architect sharpens it into a
    // command where one exists — this is a starting point, not a verdict, and
    // saying it is a passing test would be inventing something nobody wrote.
    verify: {
      kind: 'judge' as const,
      rubric: statement,
      evidence: ['diff' as const],
    },
    unverifiable: null,
  }))
}
