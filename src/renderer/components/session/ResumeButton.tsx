import React from 'react'
import { RotateCcw } from 'lucide-react'
import { planResume } from '../../sidebar/resume'
import type { SessionFacts } from '../../sidebar/session-facts'
import './ResumeButton.css'

interface Props {
  facts: SessionFacts
  onResume: (facts: SessionFacts) => void
}

/**
 * Bringing a stopped conversation back.
 *
 * Drawn only where it would work. A session whose conversation has gone says
 * so instead, because an operator who remembers working here needs to know it
 * cannot be picked up — an absent button says nothing at all.
 */
export function ResumeButton({ facts, onResume }: Props): JSX.Element | null {
  if (planResume(facts) !== null) {
    return (
      <button
        type="button"
        className="resume-button"
        aria-label={`Resume ${facts.name}`}
        onClick={(e) => {
          e.stopPropagation()
          onResume(facts)
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <RotateCcw aria-hidden="true" />
        Resume
      </button>
    )
  }

  const stopped = facts.isClosed || facts.state === 'exited'
  if (stopped && facts.agent !== null) {
    return <span className="resume-button__gone">Conversation no longer available</span>
  }
  return null
}
