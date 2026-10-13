import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import { closeAllContextMenus } from '../ContextMenu'
import { useMenuPlacement } from '../use-menu-placement'

/**
 * One drop-down menu's state: open or not, where its panel sits, and closing
 * on any click outside it or when another context menu opens.
 */
export function useMenu() {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const placement = useMenuPlacement(open, buttonRef, panelRef)

  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    window.addEventListener('click', close)
    window.addEventListener('close-context-menus', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('close-context-menus', close)
    }
  }, [open])

  const toggle = (): void => {
    closeAllContextMenus()
    setOpen((v) => !v)
  }

  return { open, close: () => setOpen(false), toggle, buttonRef, panelRef, placement }
}

interface MenuChoiceProps {
  checked: boolean
  onSelect: () => void
  kind?: 'radio' | 'checkbox'
  children: ReactNode
}

/** One radio or checkbox row in a sidebar menu, marked on when checked. */
export function MenuChoice({
  checked,
  onSelect,
  kind = 'radio',
  children,
}: MenuChoiceProps): JSX.Element {
  return (
    <button
      type="button"
      role={kind === 'radio' ? 'menuitemradio' : 'menuitemcheckbox'}
      aria-checked={checked}
      className={`sidebar-menu__item${checked ? ' sidebar-menu__item--on' : ''}`}
      onClick={onSelect}
    >
      {children}
    </button>
  )
}
