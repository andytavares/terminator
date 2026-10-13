import type React from 'react'
import { useState } from 'react'
import { closeAllContextMenus } from '../ContextMenu'

// Event handling the sidebar's rows share: a row is a button-like element with
// controls inside it, and a context menu of its own.

/** Enter or Space runs `activate`, as a click on the row does. */
export function activateOnKey(activate: () => void) {
  return (e: React.KeyboardEvent): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    activate()
  }
}

/** A click handler for a control inside a row: runs `run`, and the row under it does not also act. */
export function clickOnly(run: () => void) {
  return (e: React.MouseEvent): void => {
    e.stopPropagation()
    run()
  }
}

/** A row's context menu: where it is open, if it is. Opening it closes any other menu first. */
export function useRowMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const openRowMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    closeAllContextMenus()
    setMenu({ x: e.clientX, y: e.clientY })
  }
  return { menu, openMenu: openRowMenu, closeMenu: () => setMenu(null) }
}

/** A menu item's action that closes the menu before it runs `run`. */
export function afterClosing(closeMenu: () => void, run: () => void) {
  return (): void => {
    closeMenu()
    run()
  }
}
