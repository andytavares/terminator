import React, { useId, useState } from 'react'
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
      {...{ reason, tip, plain, tipId, showInline }}
      onShow={() => setShowInline(true)}
      control={rest}
    >
      {children}
    </Unavailable>
  )
}

interface UnavailableProps {
  readonly reason: string
  readonly tip: NonNullable<ReasonButtonProps['tip']>
  readonly plain: boolean
  readonly tipId: string
  readonly showInline: boolean
  readonly onShow: () => void
  /** Everything else the control was given. */
  readonly control: Omit<ButtonProps, 'disabled' | 'onClick' | 'children'>
  readonly children?: React.ReactNode
}

/** The control while it cannot be used: focusable, described by its reason, and saying it on a click. */
function Unavailable({
  reason,
  tip,
  plain,
  tipId,
  showInline,
  onShow,
  control,
  children,
}: UnavailableProps) {
  return (
    <span className={wrapperClassFor(tip)}>
      <Control
        plain={plain}
        {...control}
        aria-disabled="true"
        aria-describedby={tipId}
        onClick={(event) => {
          event.preventDefault()
          onShow()
        }}
      >
        {children}
      </Control>
      <ReasonText {...{ reason, tipId, showInline }} />
    </span>
  )
}

/** The reason as a tooltip, and inline once a click has asked for it. */
function ReasonText({
  reason,
  tipId,
  showInline,
}: Pick<UnavailableProps, 'reason' | 'tipId' | 'showInline'>) {
  return (
    <>
      <span role="tooltip" id={tipId} className="fdry-reason-tip">
        {reason}
      </span>
      {showInline ? <span className="fdry-inline-why">{reason}</span> : null}
    </>
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

function wrapperClassFor(tip: NonNullable<ReasonButtonProps['tip']>): string {
  if (tip === 'left') return 'fdry-reason fdry-reason--left'
  if (tip === 'fit') return 'fdry-reason fdry-reason--fit'
  return 'fdry-reason'
}
