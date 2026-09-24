import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { handleChannel } from './channel-registrar.js'
import { registerInvokeTable, invokeSpec } from './invoke-table.js'
import { notificationManager } from '../notifications/notification-manager'
import { sendToWindow } from '../safe-send'

const validationError = (err: z.ZodError) => ({ error: 'VALIDATION_ERROR', message: err.message })

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

export function registerNotificationHandlers(): void {
  handleChannel('notifications:list', () => notificationManager.list())

  registerInvokeTable([
    invokeSpec({
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
    invokeSpec({
      channel: 'notifications:dismiss',
      schema: z.object({ id: z.string().min(1) }),
      invalid: validationError,
      run: ({ id }) => {
        notificationManager.dismiss(id)
        return { ok: true }
      },
    }),
    invokeSpec({
      channel: 'notifications:trigger-action',
      schema: z.object({ notifId: z.string().min(1), actionId: z.string().min(1) }),
      invalid: validationError,
      run: ({ notifId, actionId }) => notificationManager.triggerAction(notifId, actionId),
    }),
  ])
}
