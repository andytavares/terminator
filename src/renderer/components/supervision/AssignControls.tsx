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
      <div className="sv-form">
        {/* One axis, least to most: a segmented control shows the ladder the
            four levels actually form. Four full-height rows did not. */}
        <div className="sv-segmented" role="radiogroup" aria-label="Autonomy level">
          {AUTONOMY_LEVELS.map((level) => (
            <label className="sv-segmented__option" key={level}>
              <input
                type="radio"
                name="autonomy"
                value={level}
                checked={value === level}
                onChange={() => onChange(level)}
              />
              <span>{level}</span>
            </label>
          ))}
        </div>
        <span className="sv-field__note">{LEVEL_DESCRIPTIONS[value]}</span>
        <span className="sv-field__note">
          Anything reaching a host that is not on this repository&rsquo;s allowlist asks at every
          level.
        </span>
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

export interface IntakeResultView {
  readonly ok: boolean
  readonly reason?: string
  readonly id?: string
}

export interface IntakePanelProps {
  onIntake(input: { url?: string; filePath?: string }): void
  result: IntakeResultView | null
}

/**
 * Stage 1. A ticket URL or a local document becomes a queued work item — and
 * nothing starts on its own. Auto-start on intake is what produces backlogs
 * nobody can review (FR-068).
 */
export function IntakePanel({ onIntake, result }: IntakePanelProps): JSX.Element {
  const [value, setValue] = React.useState('')

  const submit = (): void => {
    const trimmed = value.trim()
    if (trimmed === '') return
    // A path is a path; anything else is treated as a ticket URL.
    onIntake(trimmed.startsWith('/') ? { filePath: trimmed } : { url: trimmed })
    setValue('')
  }

  return (
    <div className="sv-panel">
      <div className="sv-panel__header">
        <span>Bring in a ticket</span>
      </div>
      <div className="sv-form">
        <div className="sv-inline">
          <input
            aria-label="Ticket URL or local document path"
            placeholder="https://linear.app/… or /path/to/spec.md"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
          />
          <button className="sv-queue__btn sv-btn--primary" onClick={submit}>
            Queue it
          </button>
        </div>
        {result !== null && (
          <div className={result.ok ? 'sv-result' : 'sv-warn'}>
            {result.ok
              ? `Queued as ${result.id}. It waits until you start it.`
              : (result.reason ?? 'could not bring that in')}
          </div>
        )}
      </div>
    </div>
  )
}

export interface AssignPanelProps {
  autonomy: AutonomyLevel
  /** Prefilled from the selected work item's lane, when there is one. */
  workItemId: string | null
  laneOrd: number | null
  onAssign(request: {
    repoPath: string
    branch: string
    instruction?: string
    workItemId?: string
    laneOrd?: number
  }): void
  /** The last attempt's outcome, so a refusal is never silent. */
  lastResult: { ok: boolean; reason?: string; worktreePath?: string } | null
  busy: boolean
}

/**
 * Starting a supervised session. Everything else in the console exists to
 * supervise what this creates; without it the substrate has nothing to watch.
 */
export function AssignPanel({
  autonomy,
  workItemId,
  laneOrd,
  onAssign,
  lastResult,
  busy,
}: AssignPanelProps): JSX.Element {
  const [repoPath, setRepoPath] = React.useState('')
  const [branch, setBranch] = React.useState('')
  const [instruction, setInstruction] = React.useState('')

  const ready = repoPath.trim() !== '' && branch.trim() !== ''

  const submit = (): void => {
    if (!ready || busy) return
    onAssign({
      repoPath: repoPath.trim(),
      branch: branch.trim(),
      instruction: instruction.trim() === '' ? undefined : instruction.trim(),
      workItemId: workItemId ?? undefined,
      laneOrd: laneOrd ?? undefined,
    })
  }

  return (
    <div className="sv-panel">
      <div className="sv-panel__header">
        <span>
          <Terminal aria-hidden="true" /> Start an agent
        </span>
        <span className="sv-panel__header-meta">autonomy: {autonomy}</span>
      </div>

      <div className="sv-form">
        <label className="sv-field">
          <span className="sv-field__label">Repository</span>
          <input
            aria-label="Repository path"
            placeholder="/Users/you/repos/fluent"
            value={repoPath}
            onChange={(event) => setRepoPath(event.target.value)}
          />
        </label>

        <label className="sv-field">
          <span className="sv-field__label">Branch</span>
          <input
            aria-label="Branch"
            placeholder="feat/session-ulid"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
          />
        </label>

        <label className="sv-field">
          <span className="sv-field__label">
            {workItemId === null ? 'What should it do?' : 'Anything to add?'}
          </span>
          <input
            aria-label="Instruction"
            placeholder={
              workItemId === null ? 'fix the flaky session test' : 'optional steer for this lane'
            }
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
          />
          {workItemId !== null && (
            <span className="sv-field__note">
              Bound to {workItemId}
              {laneOrd !== null && ` · lane ${laneOrd}`}
            </span>
          )}
        </label>

        <div className="sv-form__actions">
          <button
            className="sv-queue__btn sv-btn--primary"
            disabled={!ready || busy}
            onClick={submit}
          >
            {busy ? 'Starting…' : 'Start'}
          </button>
          {!ready && <span className="sv-field__note">Repository and branch are required.</span>}
        </div>

        {/* A refusal is never silent: the gate, the queue and a failed setup
            script all end here with their reason (FR-034, FR-053, FR-083). */}
        {lastResult !== null && (
          <div className={lastResult.ok ? 'sv-result' : 'sv-warn'}>
            {lastResult.ok ? (
              `Started in ${lastResult.worktreePath}`
            ) : (
              <>
                <AlertOctagon aria-hidden="true" /> {lastResult.reason ?? 'could not start'}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
