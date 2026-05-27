import { ipcMain, Notification, app } from 'electron'
import { z } from 'zod'
import { notificationManager } from '../notifications/notification-manager'

const DismissSchema = z.object({ id: z.string().min(1) })
const TriggerActionSchema = z.object({
  notifId: z.string().min(1),
  actionId: z.string().min(1),
})

export function registerNotificationHandlers(): void {
  ipcMain.on('notification:show', (_event, payload: { title: string; body: string }) => {
    if (Notification.isSupported()) {
      new Notification({ title: payload.title, body: payload.body }).show()
    }
    // Bounce the dock icon as a secondary attention signal on macOS
    if (process.platform === 'darwin' && app.dock) {
      app.dock.bounce('informational')
    }
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
