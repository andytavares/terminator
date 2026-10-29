import React from 'react'
import './extension-ui.css'

/* One choice of a few ("30 days", "Diagram"), as joined buttons; switching whole views is `Tabs`.
 * The WAI-ARIA radio group pattern (https://www.w3.org/WAI/ARIA/apg/patterns/radio/): arrows move
 * focus and choice together, Home/End jump, disabled options are skipped, one Tab stop. */

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

/** Arrow keys, Home and End move focus and the choice together. */
function moveChoice<Value extends string>(
  event: React.KeyboardEvent<HTMLDivElement>,
  onChange: (value: Value) => void
): void {
  const next = nextRadio(event.currentTarget, event.target as Element, event.key)
  if (!next) return
  event.preventDefault()
  next.focus()
  // Every value on a radio here came from `options`, so it is a Value.
  onChange(next.dataset.value as Value)
}

/** The option in the Tab order: the chosen one, or with nothing chosen the first enabled. */
function focusableValue<Value extends string>(
  options: readonly SegmentedOption<Value>[],
  value: Value
): Value | undefined {
  const chosen = options.some((option) => option.value === value)
  return chosen ? value : options.find((option) => !option.disabled)?.value
}

export function SegmentedControl<Value extends string>({
  label,
  options,
  value,
  onChange,
  size = 'md',
  className,
}: SegmentedControlProps<Value>): React.JSX.Element {
  const classes = ['tmui-segmented', `tmui-segmented--${size}`, className]
  const focusable = focusableValue(options, value)
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={classes.filter(Boolean).join(' ')}
      onKeyDown={(event) => moveChoice(event, onChange)}
    >
      {options.map((option) => (
        <SegmentedOptionButton
          key={option.value}
          option={option}
          checked={option.value === value}
          focusable={option.value === focusable}
          onChange={onChange}
        />
      ))}
    </div>
  )
}

interface SegmentedOptionButtonProps<Value extends string> {
  option: SegmentedOption<Value>
  checked: boolean
  /** The one option in the Tab order. */
  focusable: boolean
  onChange: (value: Value) => void
}

function SegmentedOptionButton<Value extends string>({
  option,
  checked,
  focusable,
  onChange,
}: SegmentedOptionButtonProps<Value>): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      data-value={option.value}
      aria-checked={checked}
      aria-label={option.accessibleName}
      title={option.title}
      tabIndex={focusable ? 0 : -1}
      disabled={option.disabled}
      className="tmui-segmented__option"
      onClick={() => onChange(option.value)}
    >
      {option.label}
    </button>
  )
}
