import { BrowserWindow, Notification, app } from 'electron'
import { randomUUID } from 'crypto'

export type NotificationType = 'info' | 'success' | 'warning' | 'error'
export type NotificationTarget = 'system' | 'center' | 'toast'

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

const ALL_TARGETS: NotificationTarget[] = ['system', 'center', 'toast']

class NotificationManager {
  private records = new Map<string, NotificationRecord>()

  create(opts: {
    type: NotificationType
    title: string
    message?: string
    source?: string
    targets?: NotificationTarget[]
    actions?: Array<{ id: string; label: string; handler: () => void }>
  }): string {
    const id = randomUUID()
    const callbacks = new Map<string, () => void>()
    const actions: NotificationAction[] = []

    for (const action of opts.actions ?? []) {
      callbacks.set(action.id, action.handler)
      actions.push({ id: action.id, label: action.label })
    }

    const targets = opts.targets ?? ALL_TARGETS
    const persistent = targets.includes('center') || targets.includes('toast')

    if (targets.includes('system') && Notification.isSupported()) {
      const notif = new Notification({ title: opts.title, body: opts.message ?? '' })
      notif.on('failed', (_e, error) => {
        console.warn('[notifications] system notification failed:', error)
      })
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
