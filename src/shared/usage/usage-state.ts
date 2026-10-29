import type { UsageFeatureRow } from './usage-types.js'

export type UsageState =
  | 'gone'
  | 'extension-off'
  | 'new'
  | 'never-used'
  | 'not-used-in-period'
  | 'used'

interface UsageStateContext {
  periodStart: string | null
  /** True or false for a known extension; undefined for 'core' and unknown ids. */
  extensionEnabled: (source: string) => boolean | undefined
}

export function usageState(row: UsageFeatureRow, context: UsageStateContext): UsageState {
  const enabled = context.extensionEnabled(row.source)
  const couldBeDeclared = row.source === 'core' || enabled === true
  if (!row.declared && couldBeDeclared) return 'gone'
  if (enabled === false) return 'extension-off'
  const { periodStart } = context
  if (periodStart !== null && row.firstDeclared >= periodStart && row.usesInPeriod === 0) {
    return 'new'
  }
  if (row.usesAllTime === 0) return 'never-used'
  if (row.usesInPeriod === 0) return 'not-used-in-period'
  return 'used'
}
