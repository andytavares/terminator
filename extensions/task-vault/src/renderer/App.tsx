import React, { useEffect } from 'react'
import { TaskVaultView, CaptureModal } from '../components/TaskVaultView'
import { CalendarDrawer } from '../components/CalendarDrawer'
import { ToastRegion } from '@terminator/extension-ui'
import { useVaultNavStore } from '../stores/vault-nav.store'
import { useExtensionToastStore } from '../stores/extension-toast.store'
import { toastPushed, type PushedNotification } from '../utils/notify'

/** Opens the capture modal on a push from the main process, or one that fired before this view existed. */
function useCaptureRequests(): void {
  const { setShowCaptureModal } = useVaultNavStore()

  useEffect(() => {
    const off = window.electronAPI.extensionBridge.on('task-vault:push:open-capture', () =>
      setShowCaptureModal(true)
    )
    return off
  }, [setShowCaptureModal])

  useEffect(() => {
    window.electronAPI.extensionBridge
      .invoke('task-vault:ui.consumePendingCapture')
      .then((result: unknown) => {
        if ((result as { data?: { pending?: boolean } }).data?.pending) setShowCaptureModal(true)
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Shows the vault's notifications, the scheduler's and the view's own, as toasts. */
function usePushToasts(): void {
  useEffect(() => {
    if (!window.electronAPI.notifications?.onPush) return
    return window.electronAPI.notifications.onPush((raw: unknown) =>
      toastPushed(raw as PushedNotification)
    )
  }, [])
}

/**
 * The vault's toasts, drawn by the shared component.
 *
 * The store keeps its own dismissal timer, so `duration: 0` tells the toast
 * not to run a second one — one owner for when a message disappears. The old
 * container this replaces printed ℹ ✓ ⚠ ✕ as text (Principle XII) and made
 * the whole toast a click target with nothing to say so.
 */
function VaultToasts(): React.JSX.Element {
  const { toasts, removeToast } = useExtensionToastStore()
  return (
    <ToastRegion
      toasts={toasts.map((t) => ({
        id: t.id,
        message: t.message,
        tone: t.type,
        duration: 0,
        action: t.onClick ? { label: 'View', onSelect: t.onClick } : undefined,
      }))}
      onDismiss={removeToast}
    />
  )
}

export function App(): JSX.Element {
  const view = new URLSearchParams(window.location.search).get('view')
  useCaptureRequests()
  usePushToasts()

  if (view === 'calendar') {
    return (
      <div className="vault-cal-panel" style={{ width: '100%', borderLeft: 'none' }}>
        <CalendarDrawer />
        <VaultToasts />
      </div>
    )
  }

  return (
    <>
      <TaskVaultView />
      <CaptureModal />
      <VaultToasts />
    </>
  )
}
