import React from 'react'
import { X } from 'lucide-react'
import type { SessionFacts } from '../../sidebar/session-facts'
import './CloseSessionButton.css'

interface Props {
  facts: SessionFacts
  onClose: (facts: SessionFacts) => void
}

/**
 * Ending a session from wherever it is shown.
 *
 * Drawn only on a live one: a session that has already closed survives as a
 * record, and there is nothing left to end. No confirmation, which is what the
 * tab bar and the sidebar already do — the record keeps the description and the
 * conversation either way.
 */
export function CloseSessionButton({ facts, onClose }: Props): JSX.Element | null {
  if (facts.isClosed) return null
  return (
    <button
      type="button"
      className="close-session"
      aria-label={`Close ${facts.name}`}
      title={`Close ${facts.name}`}
      onClick={(e) => {
        e.stopPropagation()
        onClose(facts)
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <X aria-hidden="true" />
    </button>
  )
}
