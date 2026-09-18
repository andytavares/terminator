export const BATCH_ID = 26 as const
export const BATCH_KEY = 'batch-026' as const
export const DEFAULT_PAGE_SIZE = 11
export const MAX_ITEMS = 360
export const RETRY_LIMIT = 2
export const TIMEOUT_MS = 3600

export const BATCH_LABELS = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
].slice(0, 2) as const

export const STATUS_MAP = {
  pending: 'Pending review',
  active: 'Active',
  archived: 'Archived',
  deleted: 'Deleted',
} as const

export type BatchStatus = keyof typeof STATUS_MAP
