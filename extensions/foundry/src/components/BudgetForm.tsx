import { useState } from 'react'
import { Button } from '@terminator/extension-ui'
import type { BudgetBreach } from '../line/scheduler.js'

// A budget is a whole number or no limit. Used to set an order's budgets in the
// Forge and to raise the one a run stopped at.

interface BudgetRow {
  readonly key: string
  readonly label: string
  readonly value: number | null
  /** The smallest limit this form accepts. */
  readonly min?: number
}

export interface BudgetFormProps {
  readonly rows: readonly BudgetRow[]
  readonly submitLabel: string
  readonly disabled?: boolean
  readonly onSubmit: (values: Record<string, number | null>) => void
  readonly onCancel?: () => void
}

interface Draft {
  readonly text: string
  readonly unlimited: boolean
}

function isValid(draft: Draft, min: number): boolean {
  return draft.unlimited || (/^\d+$/.test(draft.text) && Number(draft.text) >= min)
}

/** The smallest limit a row accepts: its own minimum, and never below one. */
function minOf(row: BudgetRow): number {
  return Math.max(1, row.min ?? 1)
}

function draftsOf(rows: readonly BudgetRow[]): Record<string, Draft> {
  return Object.fromEntries(
    rows.map((row) => [
      row.key,
      { text: row.value === null ? '' : String(row.value), unlimited: row.value === null },
    ])
  )
}

/** Each row's limit as typed, or null for none. */
function valuesOf(
  rows: readonly BudgetRow[],
  drafts: Readonly<Record<string, Draft>>
): Record<string, number | null> {
  return Object.fromEntries(
    rows.map((row) => {
      const draft = drafts[row.key]
      return [row.key, draft.unlimited ? null : Number(draft.text)]
    })
  )
}

/** The rows as typed so far, a way to change one, and whether every one is a limit. */
function useDrafts(rows: readonly BudgetRow[]) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => draftsOf(rows))
  const update = (key: string, next: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...next } }))
  const valid = rows.every((row) => isValid(drafts[row.key], minOf(row)))
  return { drafts, update, valid }
}

export function BudgetForm({
  rows,
  submitLabel,
  disabled = false,
  onSubmit,
  onCancel,
}: BudgetFormProps) {
  const { drafts, update, valid } = useDrafts(rows)

  return (
    <form
      className="fdry-budgets"
      onSubmit={(event) => {
        event.preventDefault()
        if (valid) onSubmit(valuesOf(rows, drafts))
      }}
    >
      {rows.map((row) => (
        <BudgetField
          key={row.key}
          row={row}
          draft={drafts[row.key]}
          disabled={disabled}
          onChange={(next) => update(row.key, next)}
        />
      ))}
      <BudgetActions {...{ submitLabel, disabled, valid, onCancel }} />
    </form>
  )
}

interface BudgetFieldProps {
  readonly row: BudgetRow
  readonly draft: Draft
  readonly disabled: boolean
  readonly onChange: (next: Partial<Draft>) => void
}

/** One budget: its limit, or a box ticked for none. */
function BudgetField({ row, draft, disabled, onChange }: BudgetFieldProps) {
  return (
    <div className="fdry-budget">
      <span className="fdry-budget-label">{row.label}</span>
      {draft.unlimited ? null : (
        <input
          type="number"
          inputMode="numeric"
          aria-label={row.label}
          min={minOf(row)}
          step={1}
          value={draft.text}
          disabled={disabled}
          aria-invalid={!isValid(draft, minOf(row))}
          onChange={(event) => onChange({ text: event.target.value })}
        />
      )}
      <NoLimit {...{ row, draft, disabled, onChange }} />
      {row.min !== undefined && !draft.unlimited ? (
        <small className="fdry-budget-min">At least {row.min}.</small>
      ) : null}
    </div>
  )
}

function NoLimit({ row, draft, disabled, onChange }: BudgetFieldProps) {
  return (
    <label className="fdry-budget-unlimited">
      <input
        type="checkbox"
        aria-label={`No limit on ${row.label.toLowerCase()}`}
        checked={draft.unlimited}
        disabled={disabled}
        onChange={(event) => onChange({ unlimited: event.target.checked })}
      />
      No limit
    </label>
  )
}

function BudgetActions({
  submitLabel,
  disabled,
  valid,
  onCancel,
}: Pick<BudgetFormProps, 'submitLabel' | 'onCancel'> & {
  readonly disabled: boolean
  readonly valid: boolean
}) {
  return (
    <div className="fdry-budget-actions">
      <Button type="submit" variant="primary" size="sm" disabled={disabled || !valid}>
        {submitLabel}
      </Button>
      {onCancel === undefined ? null : (
        <Button size="sm" disabled={disabled} onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  )
}

const BREACH_LABEL: Record<BudgetBreach['kind'], string> = {
  wall_clock: 'Minutes',
  agents: 'Agents at once',
}

/**
 * The limit a raise is offered at: a quarter above where the run already is,
 * rounded up, since a limit it reaches on the next poll stops it again.
 */
function raisedLimitFor(reached: number): number {
  return reached + Math.ceil(reached * 0.25)
}

/**
 * The new limit for the budget a run stopped at. Offered with room above where
 * the run already is, since a limit it reaches straight away stops it again.
 */
export function RaiseBudgetForm({
  breach,
  disabled,
  onRaise,
  onCancel,
}: {
  readonly breach: BudgetBreach
  readonly disabled?: boolean
  readonly onRaise: (limit: number | null) => void
  readonly onCancel: () => void
}) {
  const reached = Math.ceil(breach.actual)
  return (
    <BudgetForm
      rows={[
        {
          key: breach.kind,
          label: BREACH_LABEL[breach.kind],
          value: raisedLimitFor(reached),
          min: reached,
        },
      ]}
      submitLabel="Raise and resume"
      disabled={disabled}
      onSubmit={(values) => onRaise(values[breach.kind])}
      onCancel={onCancel}
    />
  )
}
