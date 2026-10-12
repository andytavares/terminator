import { useId, useState } from 'react'
import { Button, type ButtonProps } from '@terminator/extension-ui'

// Every Forge control that can be unavailable uses this. When a reason is
// present it renders aria-disabled instead of disabled, so it stays focusable
// (MDN: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-disabled).
// It links the reason with aria-describedby, shows a tooltip on hover and
// focus, and swallows clicks; a click instead shows the reason inline, for
// touch users and people who click before they hover.

export interface ReasonButtonProps extends Omit<ButtonProps, 'disabled'> {
  /** Why this cannot be used right now; null or undefined when it can. */
  readonly reason?: string | null
  /** Where the tooltip sits: above, right-aligned (default); above, left-aligned; or above spanning the wrapper's width. */
  readonly tip?: 'right' | 'left' | 'fit'
  /** A choice card or chip drawn by its own `className`, not as a design-system Button. */
  readonly plain?: boolean
}

function Control({ plain, variant, size, icon, ...props }: ButtonProps & { plain: boolean }) {
  if (plain) return <button type="button" {...props} />
  return <Button variant={variant} size={size} icon={icon} {...props} />
}

export function ReasonButton({
  reason,
  tip = 'right',
  plain = false,
  onClick,
  children,
  ...rest
}: ReasonButtonProps) {
  const tipId = useId()
  const [showInline, setShowInline] = useState(false)

  const [shownFor, setShownFor] = useState(reason)
  if (reason !== shownFor) {
    setShownFor(reason)
    setShowInline(false)
  }

  if (!reason) {
    return (
      <Control plain={plain} {...rest} onClick={onClick}>
        {children}
      </Control>
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
      <Control
        plain={plain}
        {...rest}
        aria-disabled="true"
        aria-describedby={tipId}
        onClick={(event) => {
          event.preventDefault()
          setShowInline(true)
        }}
      >
        {children}
      </Control>
      <span role="tooltip" id={tipId} className="fdry-reason-tip">
        {reason}
      </span>
      {showInline ? <span className="fdry-inline-why">{reason}</span> : null}
    </span>
  )
}
