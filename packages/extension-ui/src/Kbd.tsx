import React from 'react'
import './desk.css'

/** A key cap: "⌘P", "Esc". It labels a shortcut; it does not bind one. */
export function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <kbd className="tmui-kbd">{children}</kbd>
}
