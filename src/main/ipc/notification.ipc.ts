import { ipcMain } from 'electron'
import { z } from 'zod'
import { notificationManager } from '../notifications/notification-manager'

const NotificationTargetSchema = z.enum(['system', 'center', 'toast'])

const CreateSchema = z.object({
  type: z.enum(['info', 'success', 'warning', 'error']),
  title: z.string().min(1),
  message: z.string().optional(),
  targets: z.array(NotificationTargetSchema).optional(),
})

const DismissSchema = z.object({ id: z.string().min(1) })
const TriggerActionSchema = z.object({
  notifId: z.string().min(1),
  actionId: z.string().min(1),
})

export function registerNotificationHandlers(): void {
  ipcMain.handle('notifications:create', (_event, payload: unknown) => {
    const parsed = CreateSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR', message: parsed.error.message }
    const id = notificationManager.create(parsed.data)
    return { id }
  })

  ipcMain.handle('notifications:list', () => {
    return notificationManager.list()
  })

  ipcMain.handle('notifications:dismiss', (_event, payload: unknown) => {
    const parsed = DismissSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR', message: parsed.error.message }
    notificationManager.dismiss(parsed.data.id)
    return { ok: true }
  })

  ipcMain.handle('notifications:trigger-action', (_event, payload: unknown) => {
    const parsed = TriggerActionSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR', message: parsed.error.message }
    return notificationManager.triggerAction(parsed.data.notifId, parsed.data.actionId)
  })
}
