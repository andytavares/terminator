import React from 'react'
import { Wifi } from 'lucide-react'
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { RemoteControlSettings } from './components/RemoteControlSettings'

const registry = useExtensionRegistry.getState()

registry.registerGlobalTab({
  id: 'remote-control',
  label: 'Remote Control',
  icon: React.createElement(Wifi, { size: 18 }),
  component: RemoteControlSettings,
})
