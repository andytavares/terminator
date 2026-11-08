import type { Via } from '../schemas/usage.schema.js'
import type { FeatureKind } from '../schemas/usage.schema.js'

export interface UsageFeatureRow {
  id: string
  label: string
  source: string
  kind: FeatureKind
  firstDeclared: string
  lastUsedAt: string | null
  /** True when this run of the app declared the feature. */
  declared: boolean
  usesInPeriod: number
  usesAllTime: number
  activeMs: number
  failures: number
  byVia: Partial<Record<Via, number>>
  /** Uses per local day, oldest first, from the period start (or 30 days ago) to today. */
  daily: number[]
}

export interface UsageReport {
  countingSince: string | null
  features: UsageFeatureRow[]
}
