import React from 'react'
import { mountExtension } from '@terminator/extension-sdk/renderer'
import { installIconTooltips, PushedToasts } from '@terminator/extension-ui'
import '@terminator/extension-ui/fonts'
import '../components/foundry.css'
import { App } from './App'

installIconTooltips()
mountExtension(
  <>
    <App />
    {/* This view covers the core's toasts while it is on screen, so it draws its own. */}
    <PushedToasts
      source="terminator.foundry"
      subscribe={(listener) => window.electronAPI.notifications.onPush(listener)}
    />
  </>
)
