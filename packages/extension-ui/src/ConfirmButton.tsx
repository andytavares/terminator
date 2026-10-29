import React, { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from './Button'
import './extension-ui.css'

// Two clicks in place, not a modal: `window.confirm` in an extension's WebContentsView
// blocks every later event the view would receive. Arming shows what will be
// destroyed beside the button that destroys it.

export interface ConfirmButtonProps {
  /** What the control is, before it is armed. */
  readonly label: string
  /** What it does, once armed. Say the verb, not "OK". */
  readonly confirmLabel: string
  /** Exactly what will be destroyed. Not a warning about danger in general. */
  readonly warning: string
  readonly disabled?: boolean
  /** For the caller's layout, on the button before it is armed. */
  readonly className?: string
  readonly onConfirm: () => void
}

export function ConfirmButton({
  label,
  confirmLabel,
  warning,
  disabled = false,
  className,
  onConfirm,
}: ConfirmButtonProps): React.JSX.Element {
  const [armed, setArmed] = useState(false)

  if (!armed) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className={className}
        disabled={disabled}
        onClick={() => setArmed(true)}
      >
        {label}
      </Button>
    )
  }

  return (
    <ArmedConfirm
      {...{ label, confirmLabel, warning, disabled, onConfirm }}
      onDisarm={() => setArmed(false)}
    />
  )
}

/** The armed control: the sentence saying what goes, the verb that does it, and a way back. */
function ArmedConfirm({
  label,
  confirmLabel,
  warning,
  disabled,
  onConfirm,
  onDisarm,
}: Required<Omit<ConfirmButtonProps, 'className'>> & {
  readonly onDisarm: () => void
}): React.JSX.Element {
  // Disarmed before the work, not after: the second run of a
  // destructive action is a second decision, and leaving it armed
  // through a slow teardown invites a double click into being one.
  const disarmThenConfirm = (): void => {
    onDisarm()
    onConfirm()
  }
  return (
    <div className="tmui-confirm" role="group" aria-label={label}>
      <p className="tmui-confirm__warning">
        <TriangleAlert aria-hidden="true" /> {warning}
      </p>
      <div className="tmui-confirm__actions">
        <Button variant="danger" size="sm" disabled={disabled} onClick={disarmThenConfirm}>
          {confirmLabel}
        </Button>
        <Button size="sm" disabled={disabled} onClick={onDisarm}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
