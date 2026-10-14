import React from 'react'
import { mountExtension } from '@terminator/extension-sdk/renderer'
import { installIconTooltips, PushedToasts } from '@terminator/extension-ui'
import '@terminator/extension-ui/fonts'
import { App } from './App'
import '../components/notepad.css'

installIconTooltips()
mountExtension(
  <>
    <App />
    {/* This view covers the core's toasts while it is on screen, so it draws its own. */}
    <PushedToasts
      source="terminator.notepad"
      subscribe={(listener) => window.electronAPI.notifications.onPush(listener)}
    />
  </>
)
