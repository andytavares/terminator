export const BATCH_ID = 7 as const
export const BATCH_KEY = 'batch-007' as const
export const DEFAULT_PAGE_SIZE = 17
export const MAX_ITEMS = 170
export const RETRY_LIMIT = 3
export const TIMEOUT_MS = 1700

export const BATCH_LABELS = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
].slice(0, 3) as const

export const STATUS_MAP = {
  pending: 'Pending review',
  active: 'Active',
  archived: 'Archived',
  deleted: 'Deleted',
} as const

export type BatchStatus = keyof typeof STATUS_MAP
