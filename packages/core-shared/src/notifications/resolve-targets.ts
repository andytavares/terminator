export type NotificationType = 'info' | 'success' | 'warning' | 'error'
export type NotificationTarget = 'system' | 'center' | 'toast'

export interface CoreNotificationSettings {
  defaultTargets: NotificationTarget[]
  overrides: Record<string, NotificationTarget[]>
}

/**
 * Resolves delivery targets for a CORE (non-extension) notification, keyed by
 * a fixed, small set of core notification keys (e.g. 'terminalBell'). Extension
 * notifications are resolved separately, in notificationManager, via each
 * extension's own settings (see setExtensionNotificationSettingReader) — core
 * never knows what notification kinds an extension has, only its own.
 *
 * An override entry present but empty means "use default" (settings storage
 * can't represent key deletion). Errors always include 'toast' so they can't
 * be silenced.
 */
export function resolveCoreNotificationTargets(
  settings: CoreNotificationSettings,
  opts: { key: string; type: NotificationType }
): NotificationTarget[] {
  const override = settings.overrides[opts.key]
  const base = override && override.length > 0 ? override : settings.defaultTargets
  return opts.type === 'error' && !base.includes('toast') ? [...base, 'toast'] : base
}
