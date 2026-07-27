import React from 'react'
import { AlertOctagon, Terminal } from 'lucide-react'
import { AUTONOMY_LEVELS, type AutonomyLevel } from '../../../shared/types/supervision.js'
import type { BackpressureDecision, ScriptResult } from '../../../shared/supervision/view-types.js'
import './supervision.css'

// The three surfaces around starting a session: choosing how much rope, being
// refused when the review queue is full, and seeing why provisioning failed.

const LEVEL_DESCRIPTIONS: Record<AutonomyLevel, string> = {
  read: 'Read, search and list. Everything else asks.',
  edit: 'Also edits inside the worktree. Shell and network ask.',
  build: 'Also installs dependencies and runs local builds and tests. Pushing asks.',
  ship: 'Also pushes branches and opens pull requests. Destructive operations always ask.',
}

export interface AutonomyPickerProps {
  value: AutonomyLevel
  onChange(level: AutonomyLevel): void
}

/** FR-041: chosen when the agent is assigned, not renegotiated per interrupt. */
export function AutonomyPicker({ value, onChange }: AutonomyPickerProps): JSX.Element {
  return (
    <fieldset className="sv-panel">
      <legend className="sv-panel__header">How much can it do without asking?</legend>
      {AUTONOMY_LEVELS.map((level) => (
        <label className="sv-row" key={level}>
          <input
            type="radio"
            name="autonomy"
            value={level}
            checked={value === level}
            onChange={() => onChange(level)}
          />
          <span className="sv-row__main">
            <div className="sv-queue__title">{level}</div>
            <div className="sv-queue__meta">{LEVEL_DESCRIPTIONS[level]}</div>
          </span>
        </label>
      ))}
      <div className="sv-queue__meta">
        Anything reaching a host that is not on this repository&rsquo;s allowlist asks at every
        level.
      </div>
    </fieldset>
  )
}

export interface BackpressureDialogProps {
  decision: BackpressureDecision
  onOverride(): void
  onCancel(): void
  onReviewNow(): void
}

/**
 * FR-053. The refusal states the reason and the count rather than greying a
 * button out — being told why is the whole mechanism.
 */
export function BackpressureDialog({
  decision,
  onOverride,
  onCancel,
  onReviewNow,
}: BackpressureDialogProps): JSX.Element | null {
  if (decision.allowed) return null

  return (
    <div className="sv-panel" role="alertdialog" aria-label="Review queue is full">
      <div className="sv-row">
        <span className="sv-warn">
          <AlertOctagon aria-hidden="true" />
          {decision.reason}
        </span>
      </div>
      <div className="sv-queue__actions">
        <button className="sv-queue__btn" onClick={onReviewNow}>
          Review something
        </button>
        <button className="sv-queue__btn" onClick={onCancel}>
          Not now
        </button>
        {/* One action, and it is recorded with the queue depth at the time. */}
        <button className="sv-queue__btn" onClick={onOverride}>
          Start anyway ({decision.unreviewed} unreviewed)
        </button>
      </div>
    </div>
  )
}

export interface ProvisioningStatusProps {
  worktreePath: string | null
  ports: { portBase: number; portSpan: number } | null
  setup: ScriptResult | null
  skipped: ReadonlyArray<{ path: string; reason: string }>
  onOpenInEditor(): void
}

/**
 * FR-034. A failed setup is shown here with its output, so the operator never
 * has to open a transcript to find out why the worktree is broken.
 */
export function ProvisioningStatus({
  worktreePath,
  ports,
  setup,
  skipped,
  onOpenInEditor,
}: ProvisioningStatusProps): JSX.Element {
  const failed = setup !== null && setup.exitCode !== 0

  return (
    <div className="sv-panel">
      <div className="sv-panel__header">
        <span>{failed ? 'Provisioning failed' : 'Working copy'}</span>
        {worktreePath !== null && (
          <button className="sv-queue__btn" onClick={onOpenInEditor}>
            Open in editor
          </button>
        )}
      </div>

      {worktreePath !== null && (
        <div className="sv-row">
          <span className="sv-row__main">
            <div className="sv-queue__title">{worktreePath}</div>
            {ports !== null && (
              <div className="sv-queue__meta">
                ports {ports.portBase}–{ports.portBase + ports.portSpan - 1}
              </div>
            )}
          </span>
        </div>
      )}

      {skipped.map((skip) => (
        <div className="sv-row" key={skip.path}>
          {/* Recorded, never silent: this is why the worktree looks thinner
              than expected. */}
          <span className="sv-queue__meta">
            skipped {skip.path} — {skip.reason}
          </span>
        </div>
      ))}

      {setup !== null && (
        <div className="sv-row">
          <span className="sv-row__main">
            <div className="sv-state">
              <Terminal aria-hidden="true" />
              setup exited {setup.exitCode}
            </div>
            {setup.output.trim() !== '' && (
              <pre className="sv-queue__meta">{setup.output.trim()}</pre>
            )}
          </span>
        </div>
      )}

      {failed && (
        <div className="sv-row">
          <span className="sv-warn">
            <AlertOctagon aria-hidden="true" />
            No agent was started. Fix the setup command and provision again.
          </span>
        </div>
      )}
    </div>
  )
}
