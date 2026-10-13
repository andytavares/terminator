import React from 'react'

interface TaskInputProps {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel?: () => void
  placeholder?: string
  disabled?: boolean
}

interface PickerProps {
  mode: string
  value: string
  min?: string
  onChange: (v: string) => void
}

/** Plain inputs for SmartTaskInput and DateTimePicker, which have specs of their own: Enter
 *  submits, Escape cancels, a picker is named by its mode. Use as
 *  `vi.mock('<path to the component>', () => import('./helpers/input-stubs'))`. */
export function SmartTaskInput(props: TaskInputProps): React.JSX.Element {
  return (
    <input
      aria-label={props.placeholder ?? 'Task text'}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') props.onSubmit()
        if (e.key === 'Escape') props.onCancel?.()
      }}
    />
  )
}

export function DateTimePicker(props: PickerProps): React.JSX.Element {
  return (
    <input
      aria-label={`${props.mode} picker`}
      data-min={props.min}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  )
}
