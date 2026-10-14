import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { defineChannel, type ChannelSpec, validationError } from '@terminator/extension-sdk'
import { registerInvokeTable, noPayload } from './invoke-table.js'
import { notificationManager } from '../notifications/notification-manager'
import { sendToWindow } from '../safe-send'

/**
 * Clicking a notification about a session shows/focuses every window and
 * hands it the same navigate message the extension API's window.broadcast
 * sends, so the App.tsx bridge handler that already reveals a session from
 * an extension does the same for a notification.
 */
function revealSessionOnClick(sessionId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    sendToWindow(win, 'terminal:navigate-to-session', { sessionId })
  }
}

const notificationChannels: ChannelSpec[] = [
  defineChannel({
    channel: 'notifications:list',
    schema: noPayload,
    invalid: validationError,
    run: () => notificationManager.list(),
  }),
  defineChannel({
    channel: 'notifications:create',
    schema: z.object({
      type: z.enum(['info', 'success', 'warning', 'error']),
      title: z.string().min(1),
      message: z.string().optional(),
      source: z.string().optional(),
      key: z.string().min(1),
      sessionId: z.string().optional(),
    }),
    invalid: validationError,
    run: ({ sessionId, ...payload }) => {
      const onClick = sessionId !== undefined ? () => revealSessionOnClick(sessionId) : undefined
      return { id: notificationManager.create(onClick ? { ...payload, onClick } : payload) }
    },
  }),
  defineChannel({
    channel: 'notifications:dismiss',
    schema: z.object({ id: z.string().min(1) }),
    invalid: validationError,
    run: ({ id }) => {
      notificationManager.dismissNotification(id)
      return { ok: true }
    },
  }),
  defineChannel({
    channel: 'notifications:trigger-action',
    schema: z.object({ notifId: z.string().min(1), actionId: z.string().min(1) }),
    invalid: validationError,
    run: ({ notifId, actionId }) => notificationManager.triggerAction(notifId, actionId),
  }),
]

export function registerNotificationHandlers(): void {
  registerInvokeTable(notificationChannels)
}
