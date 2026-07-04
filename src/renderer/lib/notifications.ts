/**
 * Single entry point for core-renderer-originated notifications. Delivery
 * mechanism (system/center/toast) is never decided here — it's resolved by
 * notificationManager.create() in main from user settings, keyed per
 * individual notification kind (`key`, e.g. 'terminalBell') so each one is
 * independently configurable in Settings → Notifications. This just forwards
 * the request over IPC; the existing notifications:push listener (App.tsx)
 * is what turns the resolved notification into local UI state.
 */
export function dispatchNotification(opts: {
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
  key: string
}): void {
  void window.electronAPI.notifications.create(opts)
}
