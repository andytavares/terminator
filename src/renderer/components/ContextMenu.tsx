import React, { useEffect } from 'react'

export interface ContextMenuItem {
  label: string
  onSelect: () => void
  /** Renders the item in the destructive style. */
  danger?: boolean
  /** Draws a separator immediately above this item. */
  separatorBefore?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onDismiss: () => void
}

/**
 * Tells every open context menu to close. Callers dispatch this before opening
 * their own menu so two menus are never open at once.
 */
export function closeAllContextMenus(): void {
  window.dispatchEvent(new CustomEvent('close-context-menus'))
}

export function ContextMenu({ x, y, items, onDismiss }: ContextMenuProps): JSX.Element {
  useEffect(() => {
    const dismiss = (): void => onDismiss()
    window.addEventListener('click', dismiss)
    window.addEventListener('close-context-menus', dismiss)
    return () => {
      window.removeEventListener('click', dismiss)
      window.removeEventListener('close-context-menus', dismiss)
    }
  }, [onDismiss])

  return (
    <div className="ctx-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      {items.map((item) => (
        <React.Fragment key={item.label}>
          {item.separatorBefore && <div className="ctx-menu__separator" />}
          <button
            className={`ctx-menu__item${item.danger ? ' ctx-menu__item--danger' : ''}`}
            onClick={item.onSelect}
          >
            {item.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  )
}
