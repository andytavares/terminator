import React from 'react'
import type { LucideIcon } from 'lucide-react'
import './extension-ui.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> {
  /**
   * What the press means, not how loud it is. Two buttons side by side get one
   * visual weight between them: at most one is primary.
   */
  variant?: ButtonVariant
  size?: ButtonSize
  /** A lucide icon before the label. Sized by the stylesheet, never by a prop. */
  icon?: LucideIcon
  className?: string
  /** Verb first, sentence case: "Save brief", not "OK". */
  children: React.ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const classes = ['tmui-button', `tmui-button--${variant}`, `tmui-button--${size}`, className]
  return (
    <button type={type} className={classes.filter(Boolean).join(' ')} {...rest}>
      {Icon && <Icon aria-hidden="true" className="tmui-button__icon" />}
      {children}
    </button>
  )
}
