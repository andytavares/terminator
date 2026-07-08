import { z } from 'zod'
import { handleChannel } from './channel-registrar.js'
import { registerInvokeTable, invokeSpec } from './invoke-table.js'
import { notificationManager } from '../notifications/notification-manager'

const validationError = (err: z.ZodError) => ({ error: 'VALIDATION_ERROR', message: err.message })

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
      }),
      invalid: validationError,
      run: (payload) => ({ id: notificationManager.create(payload) }),
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
