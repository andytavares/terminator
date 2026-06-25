import React, { useEffect } from 'react'
import { TaskVaultView, CaptureModal } from '../components/TaskVaultView'
import { CalendarDrawer } from '../components/CalendarDrawer'
import { useVaultNavStore } from '../stores/vault-nav.store'

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

  if (view === 'calendar') {
    return <CalendarDrawer />
  }

  return (
    <>
      <TaskVaultView />
      <CaptureModal />
    </>
  )
}
