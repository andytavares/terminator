import { addExtensionToast } from '../stores/extension-toast.store'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface NotifyOptions {
  onClick?: () => void
}

export function notify(type: ToastType, message: string, opts?: NotifyOptions): void {
  addExtensionToast(type, message, { onClick: opts?.onClick })
  // Also route to notification center + system notification via the unified notification pipeline.
  // The extension-local toast above covers the in-view display; center + system reach the user
  // even when the task vault panel is closed or the user is in another app.
  void window.electronAPI?.notifications?.create({
    type,
    title: message,
    targets: ['center', 'system'],
  })
}
