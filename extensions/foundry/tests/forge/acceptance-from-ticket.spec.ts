import { describe, it, expect } from 'vitest'
import { acceptanceFromTicket } from '../../src/forge/acceptance-from-ticket.js'

// A ticket that states its acceptance criteria, taken at its word.
//
// The description arrived whole in `intent.problem` and nothing read it, so an
// order seeded from a ticket with a heading literally called "Acceptance
// Criteria" opened saying "No criteria yet". Technically true — those were the
// *order's* criteria — and useless to the person who had just written them.

const TICKET = [
  '# Summary',
  'Make all text in the application red',
  '',
  '# Acceptance Criteria',
  '- [ ] All text in the application is red',
  '- [ ] The heading is red too',
  '',
  '# Dev Hints',
  '* Text should be red',
].join('\n')

describe('acceptanceFromTicket', () => {
  it('takes the criteria a ticket states', () => {
    const found = acceptanceFromTicket(TICKET)
    expect(found.map((c) => c.statement)).toEqual([
      'All text in the application is red',
      'The heading is red too',
    ])
  })

  it('numbers them the way the rest of an order does', () => {
    expect(acceptanceFromTicket(TICKET).map((c) => c.id)).toEqual(['AC-1', 'AC-2'])
  })

  it('takes nothing from the sections either side of it', () => {
    // "Text should be red" is a dev hint, not a criterion, and it is a list
    // item under a different heading.
    const statements = acceptanceFromTicket(TICKET).map((c) => c.statement)
    expect(statements).not.toContain('Text should be red')
    expect(statements).not.toContain('Make all text in the application red')
  })

  it('gives each one a rubric with named evidence, which is what a ticket gave', () => {
    // Not a passing test: saying a sentence somebody wrote is a command with
    // an exit status would be inventing something nobody wrote. The architect
    // sharpens it where a command exists.
    const [first] = acceptanceFromTicket(TICKET)
    expect(first.verify.kind).toBe('judge')
    expect(first.verify).toMatchObject({ rubric: 'All text in the application is red' })
    expect(first.unverifiable).toBeNull()
  })

  it('reads the other things people call that heading', () => {
    for (const heading of [
      '## Acceptance',
      '### Definition of Done',
      '# Done when',
      '## Criteria',
    ]) {
      const found = acceptanceFromTicket(`${heading}\n- it works\n`)
      expect(
        found.map((c) => c.statement),
        heading
      ).toEqual(['it works'])
    }
  })

  it('reads numbered lists and ticked boxes alike', () => {
    const found = acceptanceFromTicket('# Acceptance Criteria\n1. one\n2) two\n- [x] three\n')
    expect(found.map((c) => c.statement)).toEqual(['one', 'two', 'three'])
  })

  it('allows a sentence of preamble before the list', () => {
    const found = acceptanceFromTicket('# Acceptance Criteria\nAll of these:\n- one\n- two\n')
    expect(found.map((c) => c.statement)).toEqual(['one', 'two'])
  })

  it('finds nothing in a ticket that states nothing', () => {
    expect(acceptanceFromTicket('# Summary\nJust do the thing.\n')).toEqual([])
    expect(acceptanceFromTicket('')).toEqual([])
  })

  it('does not mistake a bare list for criteria', () => {
    // A list somewhere in a description is as likely to be reproduction steps
    // or a checklist of links. Inventing criteria out of one is worse than
    // finding none.
    expect(acceptanceFromTicket('- open the app\n- click the thing\n')).toEqual([])
  })
})
