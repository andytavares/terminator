import React from 'react'
import { X } from 'lucide-react'
import type { SessionFacts } from '../../sidebar/session-facts'
import './CloseSessionButton.css'

interface Props {
  facts: SessionFacts
  onClose: (facts: SessionFacts) => void
  /** Offered on a closed session: drop what is left of it from the list. */
  onForget?: (facts: SessionFacts) => void
}

/**
 * Ending a session, or clearing away what is left of one.
 *
 * The same control in both places, because it answers the same question — take
 * this off my list. On a live session it ends the terminal and the record stays
 * under Closed; on a closed one it removes the record, which is the only way to
 * clear history before the thirty days are up. Neither asks first, as the tab
 * bar and the sidebar do not.
 */
export function CloseSessionButton({ facts, onClose, onForget }: Props): JSX.Element | null {
  const forgetting = facts.isClosed
  if (forgetting && onForget === undefined) return null
  const label = forgetting ? `Remove ${facts.name} from the list` : `Close ${facts.name}`
  return (
    <button
      type="button"
      className="close-session"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        if (forgetting) onForget!(facts)
        else onClose(facts)
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <X aria-hidden="true" />
    </button>
  )
}
