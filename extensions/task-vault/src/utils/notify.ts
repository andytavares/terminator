import { useToastStore } from '../../../../src/renderer/stores/toast.store'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface NotifyOptions {
  onClick?: () => void
}

export function notify(type: ToastType, message: string, opts?: NotifyOptions): void {
  useToastStore.getState().addToast({ type, message, onClick: opts?.onClick })
  window.electronAPI.extensionBridge
    .invoke('task-vault:system-notify', { title: 'Task Vault', body: message })
    .catch(() => {})
}
