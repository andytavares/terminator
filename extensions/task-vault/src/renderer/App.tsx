import React, { useEffect } from 'react'
import { TaskVaultView, CaptureModal } from '../components/TaskVaultView'
import { CalendarDrawer } from '../components/CalendarDrawer'
import { ExtensionToastContainer } from '../components/ExtensionToastContainer'
import { useVaultNavStore } from '../stores/vault-nav.store'
import { addExtensionToast, type ToastType } from '../stores/extension-toast.store'

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
    const off = window.electronAPI.extensionBridge.on(
      'ext:command:task-vault:capture-to-inbox',
      () => setShowCaptureModal(true)
    )
    return off
  }, [setShowCaptureModal])

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
        <ExtensionToastContainer />
      </div>
    )
  }

  return (
    <>
      <TaskVaultView />
      <CaptureModal />
      <ExtensionToastContainer />
    </>
  )
}
