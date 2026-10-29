import React from 'react'
import { Check } from 'lucide-react'
import './desk.css'

export interface CheckboxProps {
  checked: boolean
  /** Names the box for assistive technology: "Tests pass". */
  label: string
  /** Without it the box only shows a state and cannot be pressed. */
  onChange?: (checked: boolean) => void
}

export function Checkbox({ checked, label, onChange }: CheckboxProps): React.JSX.Element {
  const tick = checked ? <Check strokeWidth={3} aria-hidden="true" /> : null
  if (!onChange) {
    return (
      <span role="checkbox" aria-checked={checked} aria-label={label} className="tmui-checkbox">
        {tick}
      </span>
    )
  }
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className="tmui-checkbox"
      onClick={() => onChange(!checked)}
    >
      {tick}
    </button>
  )
}
