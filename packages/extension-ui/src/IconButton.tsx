import React from 'react'
import type { LucideIcon } from 'lucide-react'
import './extension-ui.css'

export interface IconButtonProps {
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
  onClick: () => void
  pressed?: boolean
  className?: string
}

export function IconButton({
  icon: Icon,
  label,
  onClick,
  pressed,
  className,
}: IconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={`tmui-icon-button${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      onClick={onClick}
    >
      {/* No size prop: Principle XII requires CSS control the drawn size. */}
      <Icon aria-hidden="true" />
    </button>
  )
}
