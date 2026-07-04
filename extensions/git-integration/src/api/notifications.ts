const bridge = () => window.electronAPI.extensionBridge

export type NotifyType = 'info' | 'success' | 'warning' | 'error'

export const notificationsAPI = {
  notify: (
    type: NotifyType,
    title: string,
    message?: string
  ): Promise<{ ok: true } | { error: string }> =>
    bridge().invoke('git:notify', { type, title, message }),
}
