import type { AgentState, TerminalSession } from '../../shared/types/index'

// The resting presentation of a session. Pure: no clock, no store, no I/O —
// same rule the rest of this directory follows, and what makes the four states
// exhaustively testable without a DOM.

/** Icon keys, resolved to lucide components by the component that renders them. */
export type StatusIcon = 'play' | 'circle' | 'pause' | 'circle-x'

export interface StatusPresentation {
  /**
   * Shape carries the state. Colour never does: Principle XII forbids it on an
   * icon element, and a state a user cannot read in greyscale is not readable.
   */
  icon: StatusIcon
  /** What the row's accessible name says, because shape means nothing to a reader. */
  label: string
  /** True only for the state that is blocked on the user; drives the row edge bar. */
  emphasises: boolean
}

/**
 * Keyed by every member of AgentState, so adding a state to the union is a
 * compile error here until it is given a presentation — the mapping cannot
 * silently fall through to a default.
 */
const PRESENTATION: Record<AgentState, StatusPresentation> = {
  working: { icon: 'play', label: 'Running', emphasises: false },
  idle: { icon: 'circle', label: 'Idle', emphasises: false },
  'awaiting-input': { icon: 'pause', label: 'Waiting on you', emphasises: true },
  exited: { icon: 'circle-x', label: 'Exited', emphasises: false },
}

/**
 * How a session presents at rest.
 *
 * Reads `agentState` and nothing else. Selection is deliberately not an input:
 * it is the row's surface, and conflating the two is the defect this replaces —
 * the old row spent its only glyph on "is this the row you clicked", leaving
 * running, idle and waiting indistinguishable.
 */
export function statusPresentationFor(session: TerminalSession): StatusPresentation {
  return PRESENTATION[session.agentState]
}
