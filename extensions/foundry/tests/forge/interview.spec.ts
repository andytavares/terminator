import { describe, it, expect } from 'vitest'
import { QUESTION_BUDGET, surfacedQuestions, answerQuestion } from '../../src/forge/interview.js'
import type { OpenQuestion } from '../../src/order/schema.js'

// The ergonomic core of the Forge: ten questions cost ten answers, ten stated
// assumptions cost one scan and maybe one strike. What survives as a question
// is only what the repository, the issue and the project's own conventions
// cannot answer — and never more than three at a time, ranked by how much of
// the plan each one changes.

function q(over: Partial<OpenQuestion> = {}): OpenQuestion {
  return {
    id: 'Q-1',
    text: 'does the web client render terminal rows?',
    why: 'changes whether AC-2 needs a second target',
    options: ['No', 'Yes'],
    recommended: 0,
    answer: null,
    rank: 1,
    ...over,
  }
}

describe('surfacedQuestions', () => {
  it('shows at most three at a time', () => {
    const many = Array.from({ length: 9 }, (_, i) => q({ id: `Q-${i}`, rank: i }))
    expect(surfacedQuestions(many)).toHaveLength(QUESTION_BUDGET)
  })

  it('budgets three, not some other number', () => {
    expect(QUESTION_BUDGET).toBe(3)
  })

  it('shows the questions that change the most first', () => {
    const many = [
      q({ id: 'Q-low', rank: 1 }),
      q({ id: 'Q-high', rank: 9 }),
      q({ id: 'Q-mid', rank: 5 }),
    ]
    expect(surfacedQuestions(many).map((x) => x.id)).toEqual(['Q-high', 'Q-mid', 'Q-low'])
  })

  it('never surfaces a question that has been answered', () => {
    const asked = [q({ id: 'Q-1', answer: 'No', rank: 9 }), q({ id: 'Q-2', rank: 1 })]
    expect(surfacedQuestions(asked).map((x) => x.id)).toEqual(['Q-2'])
  })

  it('shows nothing when everything is answered', () => {
    expect(surfacedQuestions([q({ answer: 'No' })])).toEqual([])
  })

  it('reveals the next question as one is answered, keeping the budget full', () => {
    const many = Array.from({ length: 5 }, (_, i) => q({ id: `Q-${i}`, rank: 5 - i }))
    const after = answerQuestion(many, 'Q-0', 'No')
    expect(surfacedQuestions(after).map((x) => x.id)).toEqual(['Q-1', 'Q-2', 'Q-3'])
  })
})

describe('answerQuestion', () => {
  it('records the answer against the question', () => {
    const after = answerQuestion([q({ id: 'Q-1' })], 'Q-1', 'No')
    expect(after[0].answer).toBe('No')
  })

  it('accepts an option index and stores the option it names', () => {
    const after = answerQuestion([q({ id: 'Q-1', options: ['No', 'Yes'] })], 'Q-1', 1)
    expect(after[0].answer).toBe('Yes')
  })

  it('leaves other questions untouched', () => {
    const before = [q({ id: 'Q-1' }), q({ id: 'Q-2' })]
    const after = answerQuestion(before, 'Q-1', 'No')
    expect(after[1].answer).toBeNull()
  })

  it('does not mutate the list it was given', () => {
    const before = [q({ id: 'Q-1' })]
    answerQuestion(before, 'Q-1', 'No')
    expect(before[0].answer).toBeNull()
  })

  it('ignores an answer to a question that does not exist rather than throwing', () => {
    const before = [q({ id: 'Q-1' })]
    expect(() => answerQuestion(before, 'Q-9', 'No')).not.toThrow()
  })

  it('ignores an option index that is out of range', () => {
    const after = answerQuestion([q({ id: 'Q-1', options: ['No'] })], 'Q-1', 7)
    expect(after[0].answer).toBeNull()
  })
})
