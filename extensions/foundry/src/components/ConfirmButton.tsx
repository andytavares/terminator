import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'

// A control that destroys something, and says what, before it does it.
//
// Two clicks in place rather than a modal. `window.confirm` inside an
// extension's WebContentsView blocks every event the view would receive
// afterwards, and a dialog that must be dismissed before the consequence can
// be read is a dialog nobody reads. Arming puts the sentence and the button
// in the same place, so the thing being agreed to is on screen at the moment
// of agreeing.

export interface ConfirmButtonProps {
  /** What the control is, before it is armed. */
  readonly label: string
  /** What it does, once armed. Say the verb, not "OK". */
  readonly confirmLabel: string
  /** Exactly what will be destroyed. Not a warning about danger in general. */
  readonly warning: string
  readonly disabled?: boolean
  readonly onConfirm: () => void
}

export function ConfirmButton({
  label,
  confirmLabel,
  warning,
  disabled = false,
  onConfirm,
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false)

  if (!armed) {
    return (
      <button
        type="button"
        className="fdry-discard"
        disabled={disabled}
        onClick={() => setArmed(true)}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="fdry-confirm" role="group" aria-label={label}>
      <p className="fdry-note">
        <TriangleAlert aria-hidden="true" /> {warning}
      </p>
      <div className="fdry-ask-actions">
        <button
          type="button"
          className="fdry-discard"
          disabled={disabled}
          onClick={() => {
            // Disarmed before the work, not after: the second run of a
            // destructive action is a second decision, and leaving it armed
            // through a slow teardown invites a double click into being one.
            setArmed(false)
            onConfirm()
          }}
        >
          {confirmLabel}
        </button>
        <button type="button" disabled={disabled} onClick={() => setArmed(false)}>
          Cancel
        </button>
      </div>
    </div>
  )
}
