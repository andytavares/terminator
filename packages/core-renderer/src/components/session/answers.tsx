import React from 'react'
import { ChoiceButtons } from './ChoiceButtons'
import { answerChoice } from '../../terminal/session-controller'
import type { SessionFacts } from '../../sidebar/session-facts'

/** The answer buttons for a session showing a numbered prompt, or nothing. */
export function answersFor(facts: SessionFacts): React.ReactNode {
  if (facts.choicePrompt === null) return null
  return (
    <ChoiceButtons
      prompt={facts.choicePrompt}
      onAnswer={(number) => answerChoice(facts.sessionId, number)}
    />
  )
}
