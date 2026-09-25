import React from 'react'
import { ICON_FOR_STATE, STATUS_ICON } from '../../sidebar/state-icons'
import { statusPresentationForState } from '../../sidebar/session-status'
import type { AgentState } from '../../../shared/types/index'
import './StateChip.css'

/**
 * A session's state as the sidebar, tabs, Home, the Logbook and the wall all
 * draw it: shape and opacity carry the state on the glyph itself, never hue
 * (Constitution XII). Colour is spent only on the chip.s fill and ring,
 * for the two states that ask something of the operator — needs-you and
 * working — and never as the glyph's or the label's colour.
 */
export function StateChip({
  state,
  compact = false,
}: {
  state: AgentState
  compact?: boolean
}): JSX.Element {
  const Icon = STATUS_ICON[ICON_FOR_STATE[state]]
  const label = statusPresentationForState(state).label
  return (
    <span
      className={`state-chip state-chip--${state}${compact ? ' state-chip--compact' : ''}`}
      role="img"
      aria-label={label}
    >
      <span className={`state-chip__icon state-chip__icon--${state}`}>
        <Icon aria-hidden="true" data-state={state} />
      </span>
      {!compact && <span className="state-chip__label">{label}</span>}
    </span>
  )
}
