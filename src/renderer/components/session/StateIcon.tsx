import React from 'react'
import { ICON_FOR_STATE, STATUS_ICON } from '../../sidebar/state-icons'
import { statusPresentationForState } from '../../sidebar/session-status'
import type { AgentState } from '../../../shared/types/index'
import './StateIcon.css'

/** A session's state as the sidebar, tabs, Home and the wall all draw it: shape and opacity, never hue. */
export function StateIcon({ state }: { state: AgentState }): JSX.Element {
  const Icon = STATUS_ICON[ICON_FOR_STATE[state]]
  return (
    <span
      className={`state-icon state-icon--${state}`}
      role="img"
      aria-label={statusPresentationForState(state).label}
    >
      <Icon aria-hidden="true" />
    </span>
  )
}
