import type { ExtensionAPI, ExtensionDB } from '@terminator/extension-sdk'

/** Days a task may roll over on Today before it is marked stale and offered in the weekly review. */
export const STALE_THRESHOLD_KEY = 'terminator.task-vault.staleThresholdDays'

export const STALE_THRESHOLD = { default: 7, min: 1, max: 365 } as const

/** The setting, defaulted and kept within its bounds: the settings page stores what was typed. */
export function staleDaysThreshold(api: ExtensionAPI): number {
  const stored = api.settings.get<unknown>(STALE_THRESHOLD_KEY)
  const days = Number(stored)
  if (stored === '' || stored === undefined || !Number.isFinite(days)) {
    return STALE_THRESHOLD.default
  }
  return Math.min(STALE_THRESHOLD.max, Math.max(STALE_THRESHOLD.min, Math.round(days)))
}

/**
 * Earlier versions kept the threshold in the vault's own settings table, where
 * only the remote API could change it. It moves to the setting once, and the
 * row goes, so there is one place it is read from.
 */
export async function migrateStoredStaleThreshold(
  api: ExtensionAPI,
  db: ExtensionDB
): Promise<void> {
  const row = await db.get<{ value: string }>(
    `SELECT value FROM settings WHERE extension_id='task-vault' AND key='stale_days_threshold'`
  )
  if (!row) return
  const days = parseInt(row.value, 10)
  if (Number.isFinite(days)) api.settings.set(STALE_THRESHOLD_KEY, days)
  await db.run(
    `DELETE FROM settings WHERE extension_id='task-vault' AND key='stale_days_threshold'`
  )
}
