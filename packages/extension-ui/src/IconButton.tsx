import React from 'react'
import type { LucideIcon } from 'lucide-react'
import './extension-ui.css'

export type IconButtonSize = 'sm' | 'md'

export interface IconButtonProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    'children' | 'className' | 'title' | 'aria-label' | 'aria-pressed' | 'onClick'
  > {
  icon: LucideIcon
  /**
   * Required, and there is no way around it.
   *
   * The extensions labelled icon-only controls with `title` alone, so Task
   * Vault's list, kanban, calendar and settings toggles had no accessible name
   * — enumerating every button in the running view returned neither. A tooltip
   * is not a label: it never appears for keyboard users and never on touch.
   */
  label: string
  /** A longer tooltip than the label, when the action needs explaining. The label stays the name. */
  description?: string
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  pressed?: boolean
  /** `sm` for a dense row or inside a chip; `md` everywhere else. Each is its size's control height,
   *  so it lines up with a field or a Button of the same size. */
  size?: IconButtonSize
  className?: string
}

export function IconButton({
  icon: Icon,
  label,
  description,
  onClick,
  pressed,
  size = 'md',
  className,
  ...rest
}: IconButtonProps): JSX.Element {
  const classes = ['tmui-icon-button', size === 'sm' && 'tmui-icon-button--sm', className]
  return (
    <button
      type="button"
      {...rest}
      className={classes.filter(Boolean).join(' ')}
      aria-label={label}
      title={description ?? label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      onClick={onClick}
    >
      {/* No size prop: Principle XII requires CSS control the drawn size. */}
      <Icon aria-hidden="true" />
    </button>
  )
}
