export type NotificationType = 'info' | 'success' | 'warning' | 'error'
export type NotificationTarget = 'system' | 'center' | 'toast'

export interface NotificationSettings {
  defaultTargets: NotificationTarget[]
  extensionOverrides: Record<string, NotificationTarget[]>
}

/**
 * Single source of truth for where a notification is delivered. Callers never
 * supply targets themselves — this resolves them from user settings (a
 * per-extension override takes precedence over the global default; an empty
 * override array means "use default", since settings storage can't represent
 * key deletion). Errors always include 'toast' so they can't be silenced.
 */
export function resolveNotificationTargets(
  settings: NotificationSettings,
  opts: { source?: string; type: NotificationType }
): NotificationTarget[] {
  const override = opts.source ? settings.extensionOverrides[opts.source] : undefined
  const base = override && override.length > 0 ? override : settings.defaultTargets
  return opts.type === 'error' && !base.includes('toast') ? [...base, 'toast'] : base
}
