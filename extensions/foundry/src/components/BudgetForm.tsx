import { useState } from 'react'
import { smallestBudgetFor } from '../order/compile.js'
import type { BudgetBreach } from '../line/scheduler.js'

// A budget is a whole number or no limit. Used to set an order's budgets in the
// Forge and to raise the one a run stopped at.

export interface BudgetRow {
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

export function BudgetForm({
  rows,
  submitLabel,
  disabled = false,
  onSubmit,
  onCancel,
}: BudgetFormProps) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      rows.map((row) => [
        row.key,
        { text: row.value === null ? '' : String(row.value), unlimited: row.value === null },
      ])
    )
  )
  const update = (key: string, next: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...next } }))
  const valid = rows.every((row) => isValid(drafts[row.key], Math.max(1, row.min ?? 1)))

  return (
    <form
      className="fdry-budgets"
      onSubmit={(event) => {
        event.preventDefault()
        if (!valid) return
        onSubmit(
          Object.fromEntries(
            rows.map((row) => {
              const draft = drafts[row.key]
              return [row.key, draft.unlimited ? null : Number(draft.text)]
            })
          )
        )
      }}
    >
      {rows.map((row) => {
        const draft = drafts[row.key]
        return (
          <div key={row.key} className="fdry-budget">
            <span className="fdry-budget-label">{row.label}</span>
            {draft.unlimited ? null : (
              <input
                type="number"
                inputMode="numeric"
                aria-label={row.label}
                min={Math.max(1, row.min ?? 1)}
                step={1}
                value={draft.text}
                disabled={disabled}
                aria-invalid={!isValid(draft, Math.max(1, row.min ?? 1))}
                onChange={(event) => update(row.key, { text: event.target.value })}
              />
            )}
            <label className="fdry-budget-unlimited">
              <input
                type="checkbox"
                aria-label={`No limit on ${row.label.toLowerCase()}`}
                checked={draft.unlimited}
                disabled={disabled}
                onChange={(event) => update(row.key, { unlimited: event.target.checked })}
              />
              No limit
            </label>
            {row.min !== undefined && !draft.unlimited ? (
              <small className="fdry-budget-min">At least {row.min}.</small>
            ) : null}
          </div>
        )
      })}
      <div className="fdry-budget-actions">
        <button type="submit" className="is-primary" disabled={disabled || !valid}>
          {submitLabel}
        </button>
        {onCancel === undefined ? null : (
          <button type="button" disabled={disabled} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

const BREACH_LABEL: Record<BudgetBreach['kind'], string> = {
  wall_clock: 'Minutes',
  files_touched: 'Files touched',
  agents: 'Agents at once',
}

/**
 * The new limit for the budget a run stopped at. Offered with room above where
 * the run already is, since a limit it reaches on the next file stops it again.
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
          value: smallestBudgetFor(reached),
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
