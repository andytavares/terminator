import React, { useEffect, useCallback } from 'react'
import { Bell, Info, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import { useNotificationStore, type Notification } from '../stores/notification.store'
import { AlertBadge } from './AlertBadge'
import './NotificationPanel.css'

function TypeIcon({ type }: { type: string }): JSX.Element {
  const props = { size: 13, className: 'notif-item__type-icon' }
  switch (type) {
    case 'success':
      return <CheckCircle {...props} />
    case 'warning':
      return <AlertTriangle {...props} />
    case 'error':
      return <XCircle {...props} />
    default:
      return <Info {...props} />
  }
}

function relativeTime(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function NotificationItem({
  notification,
  onNavigate,
}: {
  notification: Notification
  onNavigate: () => void
}): JSX.Element {
  const { dismiss, markRead } = useNotificationStore()

  function handleClick(): void {
    if (!notification.onClick) return
    markRead(notification.id)
    onNavigate()
    notification.onClick()
  }

  function handleDismiss(e: React.MouseEvent): void {
    e.stopPropagation()
    dismiss(notification.id)
  }

  async function handleAction(e: React.MouseEvent, actionId: string): Promise<void> {
    e.stopPropagation()
    markRead(notification.id)
    await window.electronAPI.notifications.triggerAction(notification.id, actionId)
    onNavigate()
  }

  return (
    <div
      className={`notif-item${notification.read ? '' : ' notif-item--unread'}${notification.onClick ? ' notif-item--clickable' : ''}`}
      onClick={handleClick}
    >
      <TypeIcon type={notification.type} />
      <div className="notif-item__body">
        <div className="notif-item__title">{notification.title}</div>
        {notification.message && <div className="notif-item__message">{notification.message}</div>}
        <div className="notif-item__meta">
          <span className="notif-item__time">{relativeTime(notification.timestamp)}</span>
          {notification.source && notification.source !== 'core' && (
            <span className="notif-item__source">{notification.source}</span>
          )}
        </div>
        {notification.actions && notification.actions.length > 0 && (
          <div className="notif-item__actions">
            {notification.actions.map((action) => (
              <button
                key={action.id}
                className="notif-item__action-btn"
                onClick={(e) => void handleAction(e, action.id)}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="notif-item__dismiss" onClick={handleDismiss} title="Dismiss">
        ×
      </button>
    </div>
  )
}

export function BellButton({
  unreadCount,
  onClick,
}: {
  unreadCount: number
  onClick: () => void
}): JSX.Element {
  return (
    <button
      className={`notif-bell${unreadCount > 0 ? ' notif-bell--active' : ''}`}
      onClick={onClick}
      title="Notifications"
      aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
    >
      <Bell size={15} />
      <AlertBadge count={unreadCount} className="alert-badge--tab" />
    </button>
  )
}

export function NotificationPanel(): JSX.Element | null {
  const { panelOpen, closePanel, notifications, markAllRead, clearAll } = useNotificationStore()

  function handleNavigate(): void {
    closePanel()
  }

  const handleKeyDown = useCallback(
    (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closePanel()
    },
    [closePanel]
  )

  useEffect(() => {
    if (panelOpen) {
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [panelOpen, handleKeyDown])

  if (!panelOpen) return null

  return (
    <>
      <div className="notif-backdrop" onClick={closePanel} />
      <div className="notif-panel" role="dialog" aria-label="Notifications">
        <div className="notif-panel__header">
          <span className="notif-panel__title">Notifications</span>
          {notifications.length > 0 && (
            <>
              <button className="notif-panel__action-btn" onClick={markAllRead}>
                Mark all read
              </button>
              <button className="notif-panel__action-btn" onClick={clearAll}>
                Clear all
              </button>
            </>
          )}
          <button className="notif-panel__close" onClick={closePanel} title="Close">
            ×
          </button>
        </div>
        <div className="notif-panel__list">
          {notifications.length === 0 ? (
            <div className="notif-panel__empty">
              <Bell size={24} className="notif-panel__empty-icon" />
              <span>No notifications</span>
            </div>
          ) : (
            notifications.map((n) => (
              <NotificationItem key={n.id} notification={n} onNavigate={handleNavigate} />
            ))
          )}
        </div>
      </div>
    </>
  )
}
