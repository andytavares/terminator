import { addExtensionToast } from '../stores/extension-toast.store'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

/** Which notification kind this is, and what clicking it does. */
export interface NotifyOptions {
  key: string
  onClick?: () => void
}

/**
 * `target` is the key, or the key with a click handler. The key identifies this specific notification kind (e.g. 'taskCompleted'),
 * unique within task-vault, so the user can configure its delivery target(s)
 * independently of every other task-vault notification (Settings →
 * Task Vault → Configure).
 */
export function notify(type: ToastType, message: string, target: string | NotifyOptions): void {
  const opts = typeof target === 'string' ? { key: target } : target
  const { key } = opts
  // Local, same-webview toast: the only way to get a clickable affordance,
  // since an onClick handler can't cross IPC to the main-process dispatcher.
  addExtensionToast(type, message, { onClick: opts.onClick })
  // Also route through the shared dispatcher, tagged with this extension's id so
  // its delivery targets (center/system/toast) resolve from the user's settings
  // (global default, overridable per extension) rather than being hardcoded here.
  void window.electronAPI?.notifications?.create({
    type,
    title: message,
    source: 'terminator.task-vault',
    key,
  })
}
