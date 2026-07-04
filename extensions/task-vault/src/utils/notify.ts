import { addExtensionToast } from '../stores/extension-toast.store'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface NotifyOptions {
  onClick?: () => void
}

/**
 * `key` identifies this specific notification kind (e.g. 'taskCompleted'),
 * unique within task-vault, so the user can configure its delivery target(s)
 * independently of every other task-vault notification (Settings →
 * Task Vault → Configure).
 */
export function notify(type: ToastType, message: string, key: string, opts?: NotifyOptions): void {
  // Local, same-webview toast: the only way to get a clickable affordance,
  // since an onClick handler can't cross IPC to the main-process dispatcher.
  addExtensionToast(type, message, { onClick: opts?.onClick })
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
