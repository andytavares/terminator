export const BATCH_ID = 34 as const
export const BATCH_KEY = 'batch-034' as const
export const DEFAULT_PAGE_SIZE = 19
export const MAX_ITEMS = 440
export const RETRY_LIMIT = 5
export const TIMEOUT_MS = 4400

export const BATCH_LABELS = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
].slice(0, 5) as const

export const STATUS_MAP = {
  pending: 'Pending review',
  active: 'Active',
  archived: 'Archived',
  deleted: 'Deleted',
} as const

export type BatchStatus = keyof typeof STATUS_MAP
