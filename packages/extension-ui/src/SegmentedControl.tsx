import React from 'react'
import './extension-ui.css'

/*
 * One choice out of a few, drawn as joined buttons: the WAI-ARIA radio group
 * pattern. The arrow keys move focus and the choice together, Home and End jump
 * to the ends, disabled options are skipped, and only the chosen option is in
 * the Tab order.
 * https://www.w3.org/WAI/ARIA/apg/patterns/radio/
 *
 * For a value a form or a view reads ("30 days", "Diagram"). Switching between
 * whole views with their own panels is `Tabs`.
 */

export interface SegmentedOption<Value extends string> {
  value: Value
  /** Words, or markup such as an icon; give markup an `accessibleName`. */
  label: React.ReactNode
  accessibleName?: string
  disabled?: boolean
  /** A longer description shown on hover. */
  title?: string
}

export interface SegmentedControlProps<Value extends string> {
  /** Names the group for assistive technology: "Time window". */
  label: string
  options: readonly SegmentedOption<Value>[]
  value: Value
  onChange: (value: Value) => void
  size?: 'sm' | 'md'
  className?: string
}

const MOVES: Record<string, 'previous' | 'next' | 'first' | 'last'> = {
  ArrowLeft: 'previous',
  ArrowUp: 'previous',
  ArrowRight: 'next',
  ArrowDown: 'next',
  Home: 'first',
  End: 'last',
}

function nextRadio(group: HTMLElement, from: Element, key: string): HTMLButtonElement | null {
  const move = MOVES[key]
  const radios = Array.from(
    group.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')
  )
  const current = radios.indexOf(from as HTMLButtonElement)
  if (!move || current < 0) return null
  if (move === 'first') return radios[0]
  if (move === 'last') return radios[radios.length - 1]
  const step = move === 'next' ? 1 : -1
  return radios[(current + step + radios.length) % radios.length]
}

export function SegmentedControl<Value extends string>({
  label,
  options,
  value,
  onChange,
  size = 'md',
  className,
}: SegmentedControlProps<Value>): JSX.Element {
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const next = nextRadio(event.currentTarget, event.target as Element, event.key)
    if (!next) return
    event.preventDefault()
    next.focus()
    // Every value on a radio here came from `options`, so it is a Value.
    onChange(next.dataset.value as Value)
  }
  const classes = ['tmui-segmented', `tmui-segmented--${size}`, className]
  // With nothing chosen the group still needs one way in from the keyboard.
  const chosen = options.some((option) => option.value === value)
  const focusable = chosen ? value : options.find((option) => !option.disabled)?.value
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={classes.filter(Boolean).join(' ')}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          data-value={option.value}
          aria-checked={option.value === value}
          aria-label={option.accessibleName}
          title={option.title}
          tabIndex={option.value === focusable ? 0 : -1}
          disabled={option.disabled}
          className="tmui-segmented__option"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
