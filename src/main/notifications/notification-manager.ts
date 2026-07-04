import { BrowserWindow, Notification, app } from 'electron'
import { randomUUID } from 'crypto'
import { resolveCoreNotificationTargets } from '../../shared/notifications/resolve-targets'
import type {
  NotificationTarget,
  NotificationType,
} from '../../shared/notifications/resolve-targets'
import { getGlobalSettings } from '../storage/settings-store'

export type { NotificationTarget, NotificationType }

/**
 * Resolves an extension's own per-notification-key target settings. Injected
 * by src/main/extensions/api.ts (which owns the extension settings registry)
 * at module load, rather than imported directly, to avoid a circular import:
 * api.ts already imports this module for createNotification/showToast.
 * Returns null if the extension hasn't registered settings for this key,
 * signalling the caller should fall back to the global default.
 */
export type ExtensionNotificationSettingReader = (
  extensionId: string,
  key: string
) => NotificationTarget[] | null

let readExtensionNotificationTargets: ExtensionNotificationSettingReader = () => null

export function setExtensionNotificationSettingReader(
  fn: ExtensionNotificationSettingReader
): void {
  readExtensionNotificationTargets = fn
}

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
   * are never caller-supplied — they're always resolved from user settings,
   * keyed per individual notification kind (`key`, unique within `source`),
   * so every distinct notification is independently configurable: global
   * default → per-key override, with the extension itself owning its own
   * per-key settings (core never enumerates or hardcodes extension keys).
   */
  create(opts: {
    type: NotificationType
    title: string
    message?: string
    source?: string
    key: string
    actions?: Array<{ id: string; label: string; handler: () => void }>
  }): string {
    const id = randomUUID()
    const callbacks = new Map<string, () => void>()
    const actions: NotificationAction[] = []

    for (const action of opts.actions ?? []) {
      callbacks.set(action.id, action.handler)
      actions.push({ id: action.id, label: action.label })
    }

    const globalSettings = getGlobalSettings()
    const base = opts.source
      ? (readExtensionNotificationTargets(opts.source, opts.key) ??
        globalSettings.notifications.defaultTargets)
      : resolveCoreNotificationTargets(globalSettings.notifications, {
          key: opts.key,
          type: opts.type,
        })
    const targets: NotificationTarget[] =
      opts.type === 'error' && !base.includes('toast') ? [...base, 'toast'] : base
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
