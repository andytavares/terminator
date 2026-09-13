/**
 * One budget, as configured in settings. The settings surface has only a number
 * field, so no limit is written there as 0 and comes back from here as null.
 */
export function budgetFromSetting(value: unknown, fallback: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback
  const whole = Math.floor(value)
  return whole === 0 ? null : whole
}
