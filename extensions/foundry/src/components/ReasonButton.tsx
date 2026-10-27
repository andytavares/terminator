import React, { useState } from 'react'
import { Button, type ButtonProps } from '@terminator/extension-ui'

// Every Forge control that can be unavailable uses this. When a reason is
// present it renders aria-disabled instead of disabled, so it stays focusable
// (MDN: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-disabled).
// It gives the reason as the control's title, which the design system's icon
// tooltips draw on hover and focus, and swallows clicks; a click instead shows
// the reason inline, for touch users and people who click before they hover.

export interface ReasonButtonProps extends Omit<ButtonProps, 'disabled'> {
  /** Why this cannot be used right now; null or undefined when it can. */
  readonly reason?: string | null
  /** How the button and its inline reason align in the wrapper: right (default), left, or the full width. */
  readonly align?: 'right' | 'left' | 'fit'
  /** A choice card or chip drawn by its own `className`, not as a design-system Button. */
  readonly plain?: boolean
}

function Control({ plain, variant, size, icon, ...props }: ButtonProps & { plain: boolean }) {
  if (plain) return <button type="button" {...props} />
  return <Button variant={variant} size={size} icon={icon} {...props} />
}

export function ReasonButton({
  reason,
  align = 'right',
  plain = false,
  onClick,
  children,
  ...rest
}: ReasonButtonProps) {
  const [showInline, setShowInline] = useInlineReason(reason)

  if (!reason) {
    return (
      <Control plain={plain} {...rest} onClick={onClick}>
        {children}
      </Control>
    )
  }

  return (
    <Unavailable
      {...{ reason, align, plain, showInline }}
      onShow={() => setShowInline(true)}
      control={rest}
    >
      {children}
    </Unavailable>
  )
}

interface UnavailableProps {
  readonly reason: string
  readonly align: NonNullable<ReasonButtonProps['align']>
  readonly plain: boolean
  readonly showInline: boolean
  readonly onShow: () => void
  /** Everything else the control was given. */
  readonly control: Omit<ButtonProps, 'disabled' | 'onClick' | 'children'>
  readonly children?: React.ReactNode
}

/** The control while it cannot be used: focusable, titled with its reason, and saying it on a click. */
function Unavailable({
  reason,
  align,
  plain,
  showInline,
  onShow,
  control,
  children,
}: UnavailableProps) {
  return (
    <span className={wrapperClassFor(align)}>
      <Control
        plain={plain}
        {...control}
        aria-disabled="true"
        title={reason}
        onClick={(event) => {
          event.preventDefault()
          onShow()
        }}
      >
        {children}
      </Control>
      {showInline ? <span className="fdry-inline-why">{reason}</span> : null}
    </span>
  )
}

/** Whether the reason is shown inline after a click; a new reason hides it again. */
function useInlineReason(
  reason: string | null | undefined
): readonly [boolean, (show: boolean) => void] {
  const [showInline, setShowInline] = useState(false)
  const [shownFor, setShownFor] = useState(reason)
  if (reason !== shownFor) {
    setShownFor(reason)
    setShowInline(false)
  }
  return [showInline, setShowInline]
}

function wrapperClassFor(align: NonNullable<ReasonButtonProps['align']>): string {
  if (align === 'left') return 'fdry-reason fdry-reason--left'
  if (align === 'fit') return 'fdry-reason fdry-reason--fit'
  return 'fdry-reason'
}
