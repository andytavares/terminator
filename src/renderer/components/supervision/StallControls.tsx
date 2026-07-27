import React from 'react'
import {
  EyeOff,
  Eye,
  ThumbsUp,
  ThumbsDown,
  MessageCircle,
  FileText,
  Square,
  Trash2,
} from 'lucide-react'
import type { RecordedFiring, PrecisionReport } from '../../../shared/supervision/view-types.js'
import './supervision.css'

// The controls that make shadow mode a decision rather than a setting nobody
// can find. Without this the detector records forever and never surfaces —
// which was exactly the state this component was missing from.

export interface StallControlsProps {
  shadowMode: boolean
  firings: readonly RecordedFiring[]
  precision: PrecisionReport
  onSetShadowMode(value: boolean): void
  onJudge(firingId: string, judgement: 'correct' | 'incorrect'): void
}

export function StallControls({
  shadowMode,
  firings,
  precision,
  onSetShadowMode,
  onJudge,
}: StallControlsProps): JSX.Element {
  const rate = precision.incorrectRate
  // Under 10% over a week of real work is what SC-002 asks for before you
  // let the detector interrupt you.
  const readyToLeaveShadow = rate !== null && rate < 0.1 && precision.judged >= 10

  return (
    <div className="sv-panel">
      <div className="sv-panel__header">
        <span className="sv-state">
          {shadowMode ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          {shadowMode ? 'Shadow mode — recording, not surfacing' : 'Stalls are surfaced'}
        </span>
        <button className="sv-queue__btn" onClick={() => onSetShadowMode(!shadowMode)}>
          {shadowMode ? 'Turn shadow mode off' : 'Turn shadow mode on'}
        </button>
      </div>

      <div className="sv-row">
        <span className="sv-row__main">
          <div className="sv-queue__title">
            {precision.judged === 0
              ? // Unknown is not the same as perfect, and the UI must not imply it is.
                `${precision.total} firings recorded, none judged yet`
              : `${Math.round((rate ?? 0) * 100)}% judged incorrect (${precision.incorrect} of ${precision.judged})`}
          </div>
          <div className="sv-queue__meta">
            {shadowMode && readyToLeaveShadow
              ? 'Precision looks good enough to leave shadow mode.'
              : shadowMode
                ? 'Judge some firings before deciding. A detector that cries wolf gets ignored.'
                : 'Judging keeps the precision figure honest.'}
          </div>
        </span>
      </div>

      {firings.length === 0 ? (
        <div className="sv-allclear">No stalls have fired.</div>
      ) : (
        firings.map((firing) => (
          <div className="sv-row" key={firing.id}>
            <span className="sv-row__grade">{firing.signal}</span>
            <span className="sv-row__main">
              <div className="sv-queue__title">{firing.sessionId}</div>
              <div className="sv-queue__meta">
                silence {Math.round(firing.inputs.toolSilenceMs / 60_000)}m · files{' '}
                {firing.inputs.distinctFiles} · reverts {firing.inputs.reverts}
                {firing.shadowMode && ' · shadow'}
              </div>
            </span>
            <span className="sv-queue__actions">
              <button
                className={`sv-queue__btn${firing.judgement === 'correct' ? ' sv-chip--on' : ''}`}
                aria-pressed={firing.judgement === 'correct'}
                onClick={() => onJudge(firing.id, 'correct')}
              >
                <ThumbsUp aria-hidden="true" /> Right
              </button>
              <button
                className={`sv-queue__btn${firing.judgement === 'incorrect' ? ' sv-chip--on' : ''}`}
                aria-pressed={firing.judgement === 'incorrect'}
                onClick={() => onJudge(firing.id, 'incorrect')}
              >
                <ThumbsDown aria-hidden="true" /> Wrong
              </button>
            </span>
          </div>
        ))
      )}
    </div>
  )
}

export interface StallActionsProps {
  sessionId: string
  onAsk(sessionId: string): void
  onShowTranscript(sessionId: string): void
  onInterrupt(sessionId: string): void
  onDiscard(sessionId: string): void
}

/** The four actions FR-021 requires whenever a stall is surfaced. */
export function StallActions({
  sessionId,
  onAsk,
  onShowTranscript,
  onInterrupt,
  onDiscard,
}: StallActionsProps): JSX.Element {
  return (
    <div className="sv-queue__actions">
      <button className="sv-queue__btn" onClick={() => onAsk(sessionId)}>
        <MessageCircle aria-hidden="true" /> Ask what is wrong
      </button>
      <button className="sv-queue__btn" onClick={() => onShowTranscript(sessionId)}>
        <FileText aria-hidden="true" /> Show activity
      </button>
      <button className="sv-queue__btn" onClick={() => onInterrupt(sessionId)}>
        <Square aria-hidden="true" /> Interrupt and redirect
      </button>
      <button className="sv-queue__btn" onClick={() => onDiscard(sessionId)}>
        <Trash2 aria-hidden="true" /> Discard session and worktree
      </button>
    </div>
  )
}
