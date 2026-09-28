import { useEffect, useId, useState } from 'react'

// Every Forge control that can be unavailable uses this. When a reason is
// present it renders aria-disabled instead of disabled, so it stays focusable
// (MDN: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-disabled).
// It links the reason with aria-describedby, shows a tooltip on hover and
// focus, and swallows clicks; a click instead shows the reason inline, for
// touch users and people who click before they hover.

export interface ReasonButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  /** Why this cannot be used right now; null or undefined when it can. */
  readonly reason?: string | null
  /** Where the tooltip sits: above, right-aligned (default); above, left-aligned; or above spanning the wrapper's width. */
  readonly tip?: 'right' | 'left' | 'fit'
}

export function ReasonButton({
  reason,
  tip = 'right',
  onClick,
  children,
  ...rest
}: ReasonButtonProps) {
  const tipId = useId()
  const [showInline, setShowInline] = useState(false)

  useEffect(() => {
    setShowInline(false)
  }, [reason])

  if (!reason) {
    return (
      <button {...rest} onClick={onClick}>
        {children}
      </button>
    )
  }

  const wrapperClass =
    tip === 'left'
      ? 'fdry-reason fdry-reason--left'
      : tip === 'fit'
        ? 'fdry-reason fdry-reason--fit'
        : 'fdry-reason'

  return (
    <span className={wrapperClass}>
      <button
        {...rest}
        aria-disabled="true"
        aria-describedby={tipId}
        onClick={(event) => {
          event.preventDefault()
          setShowInline(true)
        }}
      >
        {children}
      </button>
      <span role="tooltip" id={tipId} className="fdry-reason-tip">
        {reason}
      </span>
      {showInline ? <span className="fdry-inline-why">{reason}</span> : null}
    </span>
  )
}
