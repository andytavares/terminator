import React from 'react'
import { Popover, type PopoverProps } from './Popover'
import './extension-ui.css'

export type MenuProps = Omit<PopoverProps, 'role' | 'onKeyDown'>

const ITEMS = '[role^="menuitem"]:not(:disabled)'

/** Arrow keys, Home and End move between the items; a button takes Enter and Space itself. */
function moveBetweenItems(event: React.KeyboardEvent<HTMLDivElement>): void {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ITEMS))
  const at = items.indexOf(document.activeElement as HTMLElement)
  const target = {
    ArrowDown: items[(at + 1) % items.length],
    ArrowUp: items[at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length],
    Home: items[0],
    End: items[items.length - 1],
  }[event.key]
  if (!target) return
  event.preventDefault()
  target.focus()
}

/**
 * A list of actions on a popover: Escape or a click outside closes it, focus returns to the
 * control that opened it, and the arrow keys move between its `MenuItem`s (or any child with a
 * `menuitem*` role). Opens on its first item.
 */
export function Menu({ className, children, ...popover }: MenuProps): JSX.Element {
  return (
    <Popover
      {...popover}
      role="menu"
      className={`tmui-menu${className ? ` ${className}` : ''}`}
      onKeyDown={moveBetweenItems}
    >
      {children}
    </Popover>
  )
}

export interface MenuItemProps {
  onSelect: () => void
  /** Draws the item in the destructive style. */
  danger?: boolean
  className?: string
  children: React.ReactNode
}

export function MenuItem({ onSelect, danger, className, children }: MenuItemProps): JSX.Element {
  const classes = ['tmui-menu__item', danger && 'tmui-menu__item--danger', className]
  return (
    <button
      type="button"
      role="menuitem"
      className={classes.filter(Boolean).join(' ')}
      onClick={onSelect}
    >
      {children}
    </button>
  )
}
