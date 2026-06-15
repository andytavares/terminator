import { useToastStore } from '../../../../src/renderer/stores/toast.store'
import { useNotificationStore } from '../../../../src/renderer/stores/notification.store'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface NotifyOptions {
  onClick?: () => void
}

export function notify(type: ToastType, message: string, opts?: NotifyOptions): void {
  useToastStore.getState().addToast({ type, message, onClick: opts?.onClick })

  useNotificationStore.getState().addNotification({
    id: `task-vault-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    title: 'Task Vault',
    message,
    timestamp: Date.now(),
    source: 'task-vault',
    onClick: opts?.onClick,
  })

  window.electronAPI.extensionBridge
    .invoke('task-vault:system-notify', { title: 'Task Vault', body: message })
    .catch(() => {})
}
