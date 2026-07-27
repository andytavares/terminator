import React from 'react'
import {
  CircleDashed,
  Loader,
  MessageCircleQuestion,
  PauseCircle,
  CheckCircle2,
  XCircle,
  GitMerge,
  HelpCircle,
} from 'lucide-react'
import type { RuntimeState } from '../../../shared/types/supervision.js'
import './supervision.css'

// Replaces the undifferentiated activity dot with observed truth. Every icon is
// flat and inherits the current text colour; state is distinguished by shape
// and label, never by colour (Constitution XII), so it stays readable in both
// themes and to anyone who cannot rely on hue.

const ICONS: Record<RuntimeState, React.ComponentType> = {
  starting: CircleDashed,
  working: Loader,
  needs_input: MessageCircleQuestion,
  stalled: PauseCircle,
  ready: CheckCircle2,
  failed: XCircle,
  merged: GitMerge,
  unknown: HelpCircle,
}

export const STATE_LABELS: Record<RuntimeState, string> = {
  starting: 'Starting',
  working: 'Working',
  needs_input: 'Needs you',
  stalled: 'Stalled',
  ready: 'Ready to review',
  failed: 'Failed',
  merged: 'Merged',
  // Honest rather than reassuring: we lost track and have not re-established it.
  unknown: 'State unknown',
}

interface StateIndicatorProps {
  state: RuntimeState
  /** Elapsed time in the current state, rendered alongside when supplied. */
  sinceMs?: number | null
  showLabel?: boolean
}

export function formatElapsed(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  return `${Math.floor(ms / 3_600_000)}h`
}

export function StateIndicator({
  state,
  sinceMs,
  showLabel = true,
}: StateIndicatorProps): JSX.Element {
  const Icon = ICONS[state]
  const label = STATE_LABELS[state]

  return (
    <span
      className={`sv-state sv-state--${state}`}
      title={label}
      aria-label={label}
      data-state={state}
    >
      <span className="sv-state__icon" aria-hidden="true">
        <Icon />
      </span>
      {showLabel && <span className="sv-state__label">{label}</span>}
      {typeof sinceMs === 'number' && (
        <span className="sv-state__elapsed">{formatElapsed(sinceMs)}</span>
      )}
    </span>
  )
}
