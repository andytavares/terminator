import React from 'react'
import { createPortal } from 'react-dom'
import { Menu, MenuItem } from '@terminator/extension-ui'

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

/** Drawn in the document body, so the row it opened from does not receive its clicks. The native
 * popover closes it on Escape or a click outside, and closes any other menu that was open. */
export function ContextMenu(props: ContextMenuProps): JSX.Element {
  const { x, y, items, onDismiss } = props
  return createPortal(
    <div
      // The portal still bubbles through the React tree: the row behind must not act too.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {/* Keyed by the point: a right-click elsewhere while it is open must reopen it there, not
          leave the shown popover for the browser to light-dismiss on that click's release. */}
      <Menu
        key={`${x},${y}`}
        label="Actions"
        className="ctx-menu"
        at={{ x, y }}
        onDismiss={onDismiss}
      >
        <MenuItems items={items} />
      </Menu>
    </div>,
    document.body
  )
}

function MenuItems({ items }: { items: ContextMenuItem[] }): JSX.Element {
  return (
    <>
      {items.map((item) => (
        <React.Fragment key={item.label}>
          {item.separatorBefore && <div role="separator" className="ctx-menu__separator" />}
          <MenuItem
            className={`ctx-menu__item${item.danger ? ' ctx-menu__item--danger' : ''}`}
            onSelect={item.onSelect}
          >
            {item.label}
          </MenuItem>
        </React.Fragment>
      ))}
    </>
  )
}
