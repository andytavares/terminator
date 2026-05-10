import React from 'react'
import './EmptyState.css'

interface Action {
  label: string
  shortcut?: string
  onClick: () => void
}

interface EmptyStateProps {
  icon?: string
  title: string
  subtitle?: string
  actions?: Action[]
}

export function EmptyState({ icon, title, subtitle, actions }: EmptyStateProps): JSX.Element {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon">{icon}</div>}
      <div className="empty-state__title">{title}</div>
      {subtitle && <div className="empty-state__subtitle">{subtitle}</div>}
      {actions && actions.length > 0 && (
        <div className="empty-state__actions">
          {actions.map((action) => (
            <button key={action.label} className="empty-state__action-btn" onClick={action.onClick}>
              {action.label}
              {action.shortcut && <kbd className="empty-state__shortcut">{action.shortcut}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
