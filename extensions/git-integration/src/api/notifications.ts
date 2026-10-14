import { invoke } from '@terminator/extension-sdk/renderer'

export type NotifyType = 'info' | 'success' | 'warning' | 'error'

export const notificationsAPI = {
  /** `key` names the notification kind, whose delivery the user chooses in settings. */
  notify: (notification: {
    type: NotifyType
    title: string
    key: string
    message?: string
  }): Promise<{ ok: true } | { error: string }> => invoke('git:notify', notification),
}
