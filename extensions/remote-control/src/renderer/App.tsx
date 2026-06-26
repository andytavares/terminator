import React, { useEffect, useState } from 'react'
import { RemoteControlSettings } from '../components/RemoteControlSettings'

export function App(): JSX.Element {
  const [_enabled, setEnabled] = useState(false)

  useEffect(() => {
    const off = window.electronAPI.extensionBridge.on('remote:status', (data: unknown) => {
      const d = data as { enabled?: boolean }
      setEnabled(d.enabled ?? false)
    })
    return off
  }, [])

  return <RemoteControlSettings />
}
