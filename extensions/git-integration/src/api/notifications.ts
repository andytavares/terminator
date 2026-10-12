import { invoke } from '@terminator/extension-sdk/renderer'

export type NotifyType = 'info' | 'success' | 'warning' | 'error'

export const notificationsAPI = {
  notify: (
    type: NotifyType,
    title: string,
    key: string,
    message?: string
  ): Promise<{ ok: true } | { error: string }> =>
    invoke('git:notify', { type, title, key, message }),
}
