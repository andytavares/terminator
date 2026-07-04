import { BrowserWindow, Notification, app } from 'electron'
import { randomUUID } from 'crypto'
import { resolveNotificationTargets } from '../../shared/notifications/resolve-targets'
import type {
  NotificationTarget,
  NotificationType,
} from '../../shared/notifications/resolve-targets'
import { getGlobalSettings } from '../storage/settings-store'

export type { NotificationTarget, NotificationType }

export interface NotificationAction {
  id: string
  label: string
}

export interface SerializedNotification {
  id: string
  type: NotificationType
  title: string
  message?: string
  timestamp: number
  source?: string
  actions?: NotificationAction[]
  targets: NotificationTarget[]
}

interface NotificationRecord extends SerializedNotification {
  callbacks: Map<string, () => void>
}

class NotificationManager {
  private records = new Map<string, NotificationRecord>()

  /**
   * Single entry point for every notification in the app. Delivery targets
   * are never caller-supplied — they're always resolved from user settings
   * (global default, overridable per extension), so a notification's actual
   * mechanism (system/center/toast) is fully user-configurable and never
   * hardcoded at the call site.
   */
  create(opts: {
    type: NotificationType
    title: string
    message?: string
    source?: string
    actions?: Array<{ id: string; label: string; handler: () => void }>
  }): string {
    const id = randomUUID()
    const callbacks = new Map<string, () => void>()
    const actions: NotificationAction[] = []

    for (const action of opts.actions ?? []) {
      callbacks.set(action.id, action.handler)
      actions.push({ id: action.id, label: action.label })
    }

    const targets = resolveNotificationTargets(getGlobalSettings().notifications, {
      source: opts.source,
      type: opts.type,
    })
    const persistent = targets.includes('center') || targets.includes('toast')

    if (targets.includes('system') && Notification.isSupported()) {
      const notif = new Notification({ title: opts.title, body: opts.message ?? '' })
      notif.on('failed', (_e, error) => {
        console.warn('[notifications] system notification failed:', error)
      })
      if (actions.length > 0) {
        const primary = opts.actions![0]
        notif.on('click', () => primary.handler())
      }
      notif.show()
      if (process.platform === 'darwin' && app.dock) {
        app.dock.bounce('critical')
      }
    }

    if (!persistent) return id

    const record: NotificationRecord = {
      id,
      type: opts.type,
      title: opts.title,
      message: opts.message,
      timestamp: Date.now(),
      source: opts.source,
      actions: actions.length > 0 ? actions : undefined,
      targets,
      callbacks,
    }

    this.records.set(id, record)
    this.broadcast(this.serialize(record))

    return id
  }

  dismiss(id: string): void {
    this.records.delete(id)
  }

  triggerAction(notifId: string, actionId: string): { ok: true } | { error: string } {
    const record = this.records.get(notifId)
    if (!record) return { error: 'UNKNOWN_NOTIFICATION' }
    const cb = record.callbacks.get(actionId)
    if (!cb) return { error: 'UNKNOWN_ACTION' }
    cb()
    return { ok: true }
  }

  list(): SerializedNotification[] {
    return Array.from(this.records.values()).map(this.serialize)
  }

  private serialize(record: NotificationRecord): SerializedNotification {
    return {
      id: record.id,
      type: record.type,
      title: record.title,
      message: record.message,
      timestamp: record.timestamp,
      source: record.source,
      actions: record.actions,
      targets: record.targets,
    }
  }

  private broadcast(notification: SerializedNotification): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('notifications:push', notification)
      }
    }
  }
}

export const notificationManager = new NotificationManager()
