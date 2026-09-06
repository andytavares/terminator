import React, { useEffect } from 'react'
import { TaskVaultView, CaptureModal } from '../components/TaskVaultView'
import { CalendarDrawer } from '../components/CalendarDrawer'
import { ToastRegion } from '@terminator/extension-ui'
import { useVaultNavStore } from '../stores/vault-nav.store'
import {
  addExtensionToast,
  useExtensionToastStore,
  type ToastType,
} from '../stores/extension-toast.store'

interface SerializedNotification {
  id: string
  type: string
  title: string
  message?: string
  source?: string
  targets: string[]
}

export function App(): JSX.Element {
  const view = new URLSearchParams(window.location.search).get('view')
  const { setShowCaptureModal } = useVaultNavStore()

  useEffect(() => {
    const off = window.electronAPI.extensionBridge.on('task-vault:push:open-capture', () =>
      setShowCaptureModal(true)
    )
    return off
  }, [setShowCaptureModal])

  // On first mount, check whether the shortcut fired before this view existed.
  useEffect(() => {
    window.electronAPI.extensionBridge
      .invoke('task-vault:ui.consumePendingCapture')
      .then((result: unknown) => {
        if ((result as { data?: { pending?: boolean } }).data?.pending) setShowCaptureModal(true)
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Show local toasts for scheduler notifications (due tasks, blocked tasks, etc.)
  useEffect(() => {
    if (!window.electronAPI.notifications?.onPush) return
    return window.electronAPI.notifications.onPush((raw: unknown) => {
      const n = raw as SerializedNotification
      if (n.source !== 'terminator.task-vault') return
      if (!n.targets.includes('toast')) return
      const message = n.message ? `${n.title}: ${n.message}` : n.title
      addExtensionToast(n.type as ToastType, message)
    })
  }, [])

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
