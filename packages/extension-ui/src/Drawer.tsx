import React, { useLayoutEffect, useRef } from 'react'
import { ModalShell } from './ModalShell'
import './extension-ui.css'
import './desk.css'

export interface DrawerProps {
  /** Names the drawer for assistive technology: "Fix the login redirect". */
  label: string
  children: React.ReactNode
  /** Called for Escape and a press on the dimmed page; the caller then removes the drawer. */
  onDismiss: () => void
}

/** A panel docked to the right edge over a dimmed page. It is the modal shell, so Escape, the
 * inert page and returning focus are the shell's (ADR 110); focus opens on the panel itself
 * unless a field inside asks for it with `autoFocus`. */
export function Drawer({ label, children, onDismiss }: DrawerProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  // React's `autoFocus` only reaches form controls, and a layout effect here runs after the
  // shell has opened and after a field inside has taken focus, which it then keeps.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) panel.focus()
  }, [])
  return (
    <ModalShell label={label} className="tmui-drawer" onDismiss={onDismiss}>
      <div ref={panelRef} className="tmui-drawer__panel" tabIndex={-1}>
        {children}
      </div>
    </ModalShell>
  )
}
