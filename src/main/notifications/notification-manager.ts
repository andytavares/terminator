import { BrowserWindow, Notification, app } from 'electron'
import { randomUUID } from 'crypto'
import { resolveCoreNotificationTargets } from '../../shared/notifications/resolve-targets'
import type {
  NotificationTarget,
  NotificationType,
} from '../../shared/notifications/resolve-targets'
import { getGlobalSettings } from '../storage/settings-store'
import type { NotificationAction, SerializedNotification } from '../../shared/types/index'

export type { NotificationTarget }
/** @internal */
export type { NotificationType }

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

/**
 * The reserved action id behind "take me to the thing".
 *
 * Reserved rather than arbitrary so a caller cannot declare a button that
 * silently becomes the row's click target — and so the renderer can ask for it
 * without the author having to name it.
 * @internal
 */
export const OPEN_ACTION_ID = '__open__'

interface NotificationRecord extends SerializedNotification {
  callbacks: Map<string, () => void>
}

interface CreateNotificationOptions {
  type: NotificationType
  title: string
  message?: string
  source?: string
  key: string
  actions?: Array<{ id: string; label: string; handler: () => void }>
  /** Takes the operator to what this is about. A handler, not a route: only the author knows what
   * that is, and a route for all of them would be a second navigation system. Stored as a reserved
   * action, so the existing trigger path carries it across IPC, where a function cannot go. */
  onClick?: () => void
}

/** The buttons the renderer may show, and the handler behind each id. */
function collectActions(opts: CreateNotificationOptions): {
  callbacks: Map<string, () => void>
  actions: NotificationAction[]
} {
  const callbacks = new Map<string, () => void>()
  const actions: NotificationAction[] = []
  for (const action of opts.actions ?? []) {
    callbacks.set(action.id, action.handler)
    actions.push({ id: action.id, label: action.label })
  }
  // Not pushed onto `actions`: it is what clicking the row does, not a
  // button, and rendering it as one would put "Open" beside "Approve".
  if (opts.onClick) callbacks.set(OPEN_ACTION_ID, opts.onClick)
  return { callbacks, actions }
}

/** Where the user's settings send this notification; an error always reaches a toast. */
function resolveTargets(opts: CreateNotificationOptions): NotificationTarget[] {
  const globalSettings = getGlobalSettings()
  const base = opts.source
    ? (readExtensionNotificationTargets(opts.source, opts.key) ??
      globalSettings.notifications.defaultTargets)
    : resolveCoreNotificationTargets(globalSettings.notifications, {
        key: opts.key,
        type: opts.type,
      })
  return opts.type === 'error' && !base.includes('toast') ? [...base, 'toast'] : base
}

/** Clicking the OS notification opens the thing, or else runs the first action. */
function clickHandler(opts: CreateNotificationOptions): (() => void) | undefined {
  if (opts.onClick) return opts.onClick
  const first = opts.actions?.[0]
  return first === undefined ? undefined : () => first.handler()
}

function showSystemNotification(opts: CreateNotificationOptions): void {
  const notif = new Notification({ title: opts.title, body: opts.message ?? '' })
  notif.on('failed', (_e, error) => {
    console.warn('[notifications] system notification failed:', error)
  })
  const onClick = clickHandler(opts)
  if (onClick) notif.on('click', onClick)
  notif.show()
  if (process.platform === 'darwin' && app.dock) {
    app.dock.bounce('critical')
  }
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
  create(opts: CreateNotificationOptions): string {
    const id = randomUUID()
    const { callbacks, actions } = collectActions(opts)
    const targets = resolveTargets(opts)
    if (targets.includes('system') && Notification.isSupported()) showSystemNotification(opts)
    const persistent = targets.includes('center') || targets.includes('toast')
    if (!persistent) return id

    const record: NotificationRecord = {
      id,
      type: opts.type,
      title: opts.title,
      message: opts.message,
      timestamp: Date.now(),
      source: opts.source,
      actions: actions.length > 0 ? actions : undefined,
      clickable: opts.onClick !== undefined,
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
    // Acting on it settles it. A notification that survives the decision it
    // asked for teaches you to dismiss without reading — approve a phase and
    // the request to approve that phase is still sitting there. Opening the
    // thing is not a decision, though, so it leaves the row alone.
    if (actionId !== OPEN_ACTION_ID) this.dismiss(notifId)
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
      clickable: record.clickable,
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
