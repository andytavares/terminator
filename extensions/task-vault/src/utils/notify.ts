type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface NotifyOptions {
  onClick?: () => void
}

export function notify(type: ToastType, message: string, _opts?: NotifyOptions): void {
  window.electronAPI.extensionBridge
    .invoke('task-vault:system-notify', { type, title: 'Task Vault', body: message })
    .catch(() => {})
}
