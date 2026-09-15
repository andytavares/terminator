import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const answerChoice = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/terminal/session-controller', () => ({ answerChoice }))

import { answersFor } from '../../../../src/renderer/components/session/answers'
import { fact } from '../sidebar/fixtures/facts'

describe('answersFor', () => {
  it('draws nothing for a session with no prompt, including one waiting on a bell', () => {
    expect(answersFor(fact({ state: 'awaiting-input', choicePrompt: null }))).toBeNull()
  })

  it("answers the session's own prompt", () => {
    const facts = fact({
      sessionId: 's9',
      choicePrompt: {
        question: 'Proceed?',
        options: [
          { number: 1, label: 'Yes' },
          { number: 2, label: 'No' },
        ],
      },
    })
    render(<>{answersFor(facts)}</>)
    fireEvent.click(screen.getByRole('button', { name: '2. No' }))
    expect(answerChoice).toHaveBeenCalledWith('s9', 2)
  })
})
