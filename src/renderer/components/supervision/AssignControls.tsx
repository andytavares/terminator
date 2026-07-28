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
  /** Pulls the issues assigned to you in Linear. */
  onPullFromLinear(): void
  pulling: boolean
}

/**
 * Stage 1. A ticket URL or a local document becomes a queued work item — and
 * nothing starts on its own. Auto-start on intake is what produces backlogs
 * nobody can review (FR-068).
 */
export function IntakePanel({
  onIntake,
  result,
  onPullFromLinear,
  pulling,
}: IntakePanelProps): JSX.Element {
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
        <div className="sv-inline">
          <button className="sv-queue__btn" disabled={pulling} onClick={onPullFromLinear}>
            {pulling ? 'Pulling…' : 'Pull my Linear issues'}
          </button>
          <span className="sv-field__note">
            Everything assigned to you that is not finished. Nothing starts — what arrives sits in
            the queue until you start it.
          </span>
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

export interface RepoChoice {
  /** Absolute path to the repository working tree. */
  readonly path: string
  /** What the operator calls it in the sidebar. */
  readonly label: string
}

export interface AssignPanelProps {
  autonomy: AutonomyLevel
  /** Prefilled from the selected work item's lane, when there is one. */
  workItemId: string | null
  laneOrd: number | null
  /** The repositories the app already knows about, from the sidebar. */
  repos: readonly RepoChoice[]
  /** Branches in the chosen repository, or empty while they load. */
  branches: readonly string[]
  /** The repository's current branch, offered as the base for a new one. */
  currentBranch: string | null
  onRepoChange(repoPath: string): void
  onAssign(request: {
    repoPath: string
    branch: string
    isNewBranch?: boolean
    instruction?: string
    workItemId?: string
    laneOrd?: number
  }): void
  /** The last attempt's outcome, so a refusal is never silent. */
  lastResult: { ok: boolean; reason?: string; worktreePath?: string } | null
  busy: boolean
  /**
   * A ticket the operator chose to start, with its instruction and a branch
   * name suggested from its identifier. Filled in rather than started: which
   * repository, and whether the branch is new, are still theirs to say.
   */
  prefill: AssignPrefill | null
}

export interface AssignPrefill {
  /** Changes whenever a new ticket is chosen, including the same one twice. */
  readonly token: number
  readonly branch: string
  readonly instruction: string
}

/**
 * Starting a supervised session. Everything else in the console exists to
 * supervise what this creates; without it the substrate has nothing to watch.
 *
 * The repository and the branch are picked from what the app already knows —
 * the workspaces in the sidebar, and that repository's own branches. Asking an
 * operator to retype a path the app is already displaying is how you get typos
 * in the one field that cannot be wrong.
 */
export function AssignPanel({
  autonomy,
  workItemId,
  laneOrd,
  repos,
  branches,
  currentBranch,
  onRepoChange,
  onAssign,
  lastResult,
  busy,
  prefill,
}: AssignPanelProps): JSX.Element {
  const [repoPath, setRepoPath] = React.useState(repos[0]?.path ?? '')
  const [mode, setMode] = React.useState<'new' | 'existing'>('new')
  const [branch, setBranch] = React.useState('')
  const [instruction, setInstruction] = React.useState('')

  // Keyed on the token rather than the contents, so choosing the same ticket
  // again refills fields the operator has since edited — which is what asking
  // for it a second time means.
  React.useEffect(() => {
    if (prefill === null) return
    setBranch(prefill.branch)
    setMode('new')
    setInstruction(prefill.instruction)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.token])

  // Follow the sidebar: if the panel opens before the workspaces have loaded,
  // or the operator removes the one that was selected, land on a real one.
  React.useEffect(() => {
    if (repos.length === 0) return
    if (repos.some((repo) => repo.path === repoPath)) return
    setRepoPath(repos[0].path)
    onRepoChange(repos[0].path)
  }, [repos, repoPath, onRepoChange])

  const chosen = mode === 'new' ? branch.trim() : branch
  const ready = repoPath !== '' && chosen !== ''

  const submit = (): void => {
    if (!ready || busy) return
    onAssign({
      repoPath,
      branch: chosen,
      // `git worktree add -b` on a branch that already exists fails; the
      // operator already told us which case this is.
      isNewBranch: mode === 'new',
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
        {repos.length === 0 ? (
          <span className="sv-field__note">
            No repositories yet. Add a workspace in the sidebar and it will appear here.
          </span>
        ) : (
          <label className="sv-field">
            <span className="sv-field__label">Repository</span>
            <select
              aria-label="Repository"
              value={repoPath}
              onChange={(event) => {
                setRepoPath(event.target.value)
                setBranch('')
                onRepoChange(event.target.value)
              }}
            >
              {repos.map((repo) => (
                <option key={repo.path} value={repo.path}>
                  {repo.label}
                </option>
              ))}
            </select>
            {/* The path below rather than inside the option: an option string
                carrying a full path is unreadable at any real path length. */}
            <span className="sv-field__note">{repoPath}</span>
          </label>
        )}

        <div className="sv-field">
          <span className="sv-field__label">Branch</span>
          {/* New by default: an agent working directly on an existing branch is
              the case you want to have chosen deliberately. */}
          <div className="sv-segmented" role="radiogroup" aria-label="Branch">
            {(['new', 'existing'] as const).map((option) => (
              <label className="sv-segmented__option" key={option}>
                <input
                  type="radio"
                  name="branch-mode"
                  value={option}
                  checked={mode === option}
                  onChange={() => {
                    setMode(option)
                    setBranch('')
                  }}
                />
                <span>{option === 'new' ? 'New' : 'Existing'}</span>
              </label>
            ))}
          </div>

          {mode === 'new' ? (
            <>
              <input
                aria-label="New branch name"
                placeholder="feat/session-ulid"
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submit()
                }}
              />
              {currentBranch !== null && (
                <span className="sv-field__note">Branched from {currentBranch}.</span>
              )}
            </>
          ) : (
            <select
              aria-label="Existing branch"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
            >
              <option value="">Choose a branch…</option>
              {branches.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>

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
          {!ready && repos.length > 0 && (
            <span className="sv-field__note">Name the branch it should work on.</span>
          )}
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
