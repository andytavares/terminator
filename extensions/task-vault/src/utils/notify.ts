import { addExtensionToast } from '../stores/extension-toast.store'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

/** Which notification kind this is, and what clicking it does. */
export interface NotifyOptions {
  key: string
  onClick?: () => void
}

/** The part of a pushed notification that decides whether the vault draws it. */
export interface PushedNotification {
  type: ToastType
  title: string
  message?: string
  source?: string
  targets: string[]
}

const SOURCE = 'terminator.task-vault'

/** Click handlers waiting for the push that draws their toast, by title. A handler cannot cross
 * IPC to the dispatcher, so it stays here until the dispatcher has answered. */
const pendingClicks = new Map<string, () => void>()

/**
 * `target` is the key, or the key with a click handler. The key identifies this specific notification kind (e.g. 'taskCompleted'),
 * unique within task-vault, so the user can configure its delivery target(s)
 * independently of every other task-vault notification (Settings →
 * Task Vault → Configure). The toast, if the settings ask for one, is drawn by toastPushed.
 */
export function notify(type: ToastType, message: string, target: string | NotifyOptions): void {
  const opts = typeof target === 'string' ? { key: target } : target
  if (opts.onClick) pendingClicks.set(message, opts.onClick)
  // The dispatcher pushes the notification back to this view before it answers, so the
  // handler is still here when toastPushed draws the toast.
  void window.electronAPI?.notifications
    ?.create({ type, title: message, source: SOURCE, key: opts.key })
    .finally(() => pendingClicks.delete(message))
}

/** Draws a pushed task-vault notification the user's settings send to a toast. */
export function toastPushed(n: PushedNotification): void {
  if (n.source !== SOURCE || !n.targets.includes('toast')) return
  const message = n.message ? `${n.title}: ${n.message}` : n.title
  addExtensionToast(n.type, message, { onClick: pendingClicks.get(n.title) })
}
