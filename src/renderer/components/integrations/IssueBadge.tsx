import React from 'react'
import type { IssueState, IssueStateType } from '../../../shared/types/index'
import './IssueBadge.css'

// The issue key, on the project it belongs to.
//
// State is carried by a word and a shape, never by colour alone: the tooltip
// names the state, and the dot's class is derived from the state *type* rather
// than from a tracker's own palette (FR-009, WCAG 1.4.1).

export interface IssueBadgeProps {
  tracker: 'linear' | 'jira'
  issueKey: string
  /** Null when the issue could not be read — the link still exists. */
  state: IssueState | null
  title?: string
  onClick?: () => void
}

/** Five state types collapse to three visual weights; more would be noise. */
function weightOf(type: IssueStateType): 'open' | 'active' | 'closed' {
  if (type === 'started') return 'active'
  if (type === 'completed' || type === 'canceled') return 'closed'
  return 'open'
}

export function IssueBadge({
  tracker,
  issueKey,
  state,
  title,
  onClick,
}: IssueBadgeProps): JSX.Element {
  const weight = state === null ? 'open' : weightOf(state.type)
  const unavailable = state === null

  // Everything the operator needs on hover: which tracker, what state, and the
  // title, none of which fits in a badge two characters wide.
  const tooltip = [
    `${issueKey} · ${tracker === 'linear' ? 'Linear' : 'Jira'}`,
    unavailable ? 'Unavailable' : state.name,
    title,
  ]
    .filter((part) => part !== undefined && part.length > 0)
    .join(' — ')

  return (
    <button
      type="button"
      className={`issue-badge${unavailable ? ' issue-badge--unavailable' : ''}`}
      title={tooltip}
      aria-label={tooltip}
      onClick={(e) => {
        // The badge sits inside a header that selects the project on click.
        e.stopPropagation()
        onClick?.()
      }}
    >
      <span className={`issue-badge__dot issue-badge__dot--${weight}`} aria-hidden="true" />
      <span className="issue-badge__key">{issueKey}</span>
    </button>
  )
}
