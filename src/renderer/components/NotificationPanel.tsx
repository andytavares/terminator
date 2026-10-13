import { useShallow } from 'zustand/react/shallow'
import React, { useEffect, useCallback, useRef } from 'react'
import { Bell, Info, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import { RelativeTime } from '@terminator/extension-ui'
import { useNotificationStore, type Notification } from '../stores/notification.store'
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

/**
 * The reserved action behind "take me to the thing this is about".
 *
 * A notification's author is the only thing that knows where that is, and a
 * function cannot cross IPC — so the destination lives in the main process as
 * a reserved callback and the row asks for it by name.
 */
const OPEN_ACTION_ID = '__open__'

/** What a row does: open what it is about, run one of its actions, or go away. */
function useNotificationActions(notification: Notification, onNavigate: () => void) {
  const { dismiss, markRead, remove } = useNotificationStore(
    useShallow((s) => ({ dismiss: s.dismiss, markRead: s.markRead, remove: s.remove }))
  )
  // Either a local handler (core notifications, which are created in the
  // renderer) or a reserved callback in main (everything an extension raises).
  const canOpen = notification.onClick !== undefined || notification.clickable === true

  function handleClick(): void {
    if (!canOpen) return
    markRead(notification.id)
    onNavigate()
    if (notification.onClick) return notification.onClick()
    void window.electronAPI.notifications.triggerAction(notification.id, OPEN_ACTION_ID)
  }

  function handleDismiss(e: React.MouseEvent): void {
    e.stopPropagation()
    dismiss(notification.id)
  }

  async function handleAction(e: React.MouseEvent, actionId: string): Promise<void> {
    e.stopPropagation()
    // Acting on it settles it: approve a phase and the request to approve that
    // phase should not still be sitting in the list. Dropped whatever main
    // says — either it fired and main forgot the record, or the same decision
    // was already made elsewhere and there is nothing left to answer.
    await window.electronAPI.notifications.triggerAction(notification.id, actionId)
    remove(notification.id)
    onNavigate()
  }
  return { canOpen, handleClick, handleDismiss, handleAction }
}

function NotificationItem({
  notification,
  onNavigate,
}: {
  notification: Notification
  onNavigate: () => void
}): JSX.Element {
  const { canOpen, handleClick, handleDismiss, handleAction } = useNotificationActions(
    notification,
    onNavigate
  )
  return (
    <div
      className={`notif-item${notification.read ? '' : ' notif-item--unread'}${canOpen ? ' notif-item--clickable' : ''}`}
      onClick={handleClick}
    >
      <TypeIcon type={notification.type} />
      <NotificationBody notification={notification} onAction={handleAction} />
      <button className="notif-item__dismiss" onClick={handleDismiss} title="Dismiss">
        ×
      </button>
    </div>
  )
}

function NotificationBody({
  notification,
  onAction,
}: {
  notification: Notification
  onAction: (e: React.MouseEvent, actionId: string) => Promise<void>
}): JSX.Element {
  return (
    <div className="notif-item__body">
      <div className="notif-item__title">{notification.title}</div>
      {notification.message && <div className="notif-item__message">{notification.message}</div>}
      <div className="notif-item__meta">
        <span className="notif-item__time">
          <RelativeTime value={notification.timestamp} />
        </span>
        {notification.source && notification.source !== 'core' && (
          <span className="notif-item__source">{notification.source}</span>
        )}
      </div>
      {notification.actions && notification.actions.length > 0 && (
        <NotificationActions actions={notification.actions} onAction={onAction} />
      )}
    </div>
  )
}

function NotificationActions({
  actions,
  onAction,
}: {
  actions: NonNullable<Notification['actions']>
  onAction: (e: React.MouseEvent, actionId: string) => Promise<void>
}): JSX.Element {
  return (
    <div className="notif-item__actions">
      {actions.map((action) => (
        <button
          key={action.id}
          className="notif-item__action-btn"
          onClick={(e) => void onAction(e, action.id)}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}

/** Reserves the drawer's strip, as an extension's WebContentsView paints over the DOM; hiding
 * every view (`useModalEffect`) blanked the app to show a 340px drawer. Measured from the
 * rendered element, so the reservation cannot drift from the CSS. */
function useLeftInset(panelRef: React.RefObject<HTMLDivElement>): void {
  useEffect(() => {
    const setInset = (px: number): void => window.electronAPI?.extension?.setLeftInset?.(px)
    const reserve = (): void => {
      const rect = panelRef.current?.getBoundingClientRect()
      if (rect !== undefined) setInset(Math.ceil(rect.right))
    }
    reserve()
    window.addEventListener('resize', reserve)
    return () => {
      window.removeEventListener('resize', reserve)
      setInset(0)
    }
  }, [panelRef])
}

function useCloseOnEscape(closePanel: () => void): void {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closePanel()
    },
    [closePanel]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}

function NotificationPanelInner(): JSX.Element {
  const { closePanel, notifications, markAllRead, clearAll } = useNotificationStore(
    useShallow((s) => ({
      closePanel: s.closePanel,
      notifications: s.notifications,
      markAllRead: s.markAllRead,
      clearAll: s.clearAll,
    }))
  )
  const panelRef = useRef<HTMLDivElement>(null)
  useLeftInset(panelRef)
  useCloseOnEscape(closePanel)

  return (
    <>
      <div className="notif-backdrop" onClick={closePanel} />
      <div className="notif-panel" ref={panelRef} role="dialog" aria-label="Notifications">
        <div className="notif-panel__header">
          <span className="notif-panel__title">Notifications</span>
          {notifications.length > 0 && (
            <ListActions onMarkAllRead={markAllRead} onClearAll={clearAll} />
          )}
          <button className="notif-panel__close" onClick={closePanel} title="Close">
            ×
          </button>
        </div>
        <NotificationList notifications={notifications} onNavigate={closePanel} />
      </div>
    </>
  )
}

function ListActions({
  onMarkAllRead,
  onClearAll,
}: {
  onMarkAllRead: () => void
  onClearAll: () => void
}) {
  return (
    <>
      <button className="notif-panel__action-btn" onClick={onMarkAllRead}>
        Mark all read
      </button>
      <button className="notif-panel__action-btn" onClick={onClearAll}>
        Clear all
      </button>
    </>
  )
}

function NotificationList({
  notifications,
  onNavigate,
}: {
  notifications: Notification[]
  onNavigate: () => void
}): JSX.Element {
  return (
    <div className="notif-panel__list">
      {notifications.length === 0 ? (
        <div className="notif-panel__empty">
          <Bell size={24} className="notif-panel__empty-icon" />
          <span>No notifications</span>
        </div>
      ) : (
        notifications.map((n) => (
          <NotificationItem key={n.id} notification={n} onNavigate={onNavigate} />
        ))
      )}
    </div>
  )
}

export function NotificationPanel(): JSX.Element | null {
  const panelOpen = useNotificationStore((s) => s.panelOpen)
  if (!panelOpen) return null
  return <NotificationPanelInner />
}
