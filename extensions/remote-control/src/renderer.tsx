import React from 'react'
import { Wifi, WifiOff } from 'lucide-react'
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { RemoteControlSettings } from './components/RemoteControlSettings'

const registry = useExtensionRegistry.getState()

registry.registerGlobalTab({
  id: 'remote-control',
  label: 'Remote Control',
  icon: React.createElement(WifiOff, { size: 18 }),
  component: RemoteControlSettings,
  sortOrder: 999,
})

window.electronAPI.extensionBridge.on('remote:status', (data) => {
  const status = data as { enabled: boolean }
  registry.updateGlobalTab('remote-control', {
    icon: React.createElement(status.enabled ? Wifi : WifiOff, { size: 18 }),
  })
})
