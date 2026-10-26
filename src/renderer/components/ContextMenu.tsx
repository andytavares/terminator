import React, { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { keepOnScreen } from '@terminator/extension-ui'

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

/** Drawn in the document body: an ancestor with containment (Home's `container-type: size`)
 * would otherwise hold the fixed menu and clip it at its own edge. */
export function ContextMenu({ x, y, items, onDismiss }: ContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  // Before paint, so a menu opened near an edge never flashes half off screen.
  useLayoutEffect(() => keepOnScreen(ref.current), [x, y])
  useEffect(() => {
    const dismiss = (): void => onDismiss()
    window.addEventListener('click', dismiss)
    window.addEventListener('close-context-menus', dismiss)
    return () => {
      window.removeEventListener('click', dismiss)
      window.removeEventListener('close-context-menus', dismiss)
    }
  }, [onDismiss])

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItems items={items} />
    </div>,
    document.body
  )
}

function MenuItems({ items }: { items: ContextMenuItem[] }): JSX.Element {
  return (
    <>
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
    </>
  )
}
