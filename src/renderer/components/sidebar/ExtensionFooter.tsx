import React from 'react'
import type { SidebarButtonRegistration } from '../../extensions/registry'
import './ExtensionFooter.css'

interface ExtensionFooterProps {
  buttons: SidebarButtonRegistration[]
}

export function ExtensionFooter({ buttons }: ExtensionFooterProps): JSX.Element | null {
  if (buttons.length === 0) return null
  return (
    <div className="extension-footer">
      {buttons.map((btn) => (
        <button key={btn.id} className="ext-btn" onClick={btn.action} title={btn.label}>
          {btn.icon && <span className="ext-btn__icon">{btn.icon}</span>}
          <span>{btn.label}</span>
        </button>
      ))}
    </div>
  )
}
